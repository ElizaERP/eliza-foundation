import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import {
  Cantidad, EstadoReserva, Existencia, ExistenciaId, ExistenciaRepository,
  ExistenciaStockFilter, LocationId, LoteId, ReferenciaOrigen,
  Reserva, ReservaId, TipoReferencia,
} from '@eliza/contexts/inventory/domain';

@Injectable()
export class PrismaExistenciaRepository implements ExistenciaRepository {
  private readonly logger = new Logger(PrismaExistenciaRepository.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async findById(id: ExistenciaId): Promise<Existencia | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).existencia.findUnique({ where: { id: id.value }, include: { reservas: true } });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByCompositeKey(productId: string, loteId: string, locationId: string): Promise<Existencia | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).existencia.findFirst({ where: { productId, loteId, locationId }, include: { reservas: true } });
      return row ? this.toDomain(row) : null;
    });
  }

  async findBySkuOrderedByExpiry(productId: string, onlyReservable: boolean): Promise<Existencia[]> {
    return this.prisma.withTenant(async (tx) => {
      const where: any = { productId, cantidadDisponible: { gt: 0 } };
      if (onlyReservable) {
        where.lote = { estado: 'Disponible', fechaVencimiento: { gt: new Date() } };
      }
      const rows = await (tx as any).existencia.findMany({
        where, include: { reservas: true, lote: true },
        orderBy: [{ lote: { fechaVencimiento: 'asc' } }, { lote: { fechaProduccion: 'asc' } }],
      });
      return rows.map((r: any) => this.toDomain(r)).filter((e: Existencia | null): e is Existencia => e !== null);
    });
  }

  async findBySku(productId: string): Promise<Existencia[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).existencia.findMany({ where: { productId }, include: { reservas: true } });
      return rows.map((r: any) => this.toDomain(r)).filter((e: Existencia | null): e is Existencia => e !== null);
    });
  }

  async query(filter: ExistenciaStockFilter): Promise<Existencia[]> {
    return this.prisma.withTenant(async (tx) => {
      const where: any = {};
      if (filter.productId) where.productId = filter.productId;
      if (filter.loteId) where.loteId = filter.loteId;
      if (filter.locationId) where.locationId = filter.locationId;
      if (filter.minDisponible !== undefined) where.cantidadDisponible = { gte: filter.minDisponible };
      const rows = await (tx as any).existencia.findMany({ where, include: { reservas: true } });
      return rows.map((r: any) => this.toDomain(r)).filter((e: Existencia | null): e is Existencia => e !== null);
    });
  }

  async save(existencia: Existencia): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const events = existencia.pullDomainEvents();
      const expectedVersion = existencia.version - 1;
      const existing = await (tx as any).existencia.findUnique({ where: { id: existencia.id.value }, select: { id: true } });

      if (!existing) {
        await (tx as any).existencia.create({
          data: { id: existencia.id.value, tenantId: existencia.tenantId, productId: existencia.productId,
            loteId: existencia.loteId.value, locationId: existencia.locationId.value,
            cantidadDisponible: existencia.cantidadDisponible.amount,
            cantidadReservada: existencia.cantidadReservada.amount,
            cantidadBloqueada: existencia.cantidadBloqueada.amount,
            version: existencia.version, createdAt: existencia.createdAt, updatedAt: existencia.updatedAt },
        });
      } else {
        const result = await (tx as any).existencia.updateMany({
          where: { id: existencia.id.value, version: expectedVersion },
          data: { cantidadDisponible: existencia.cantidadDisponible.amount,
            cantidadReservada: existencia.cantidadReservada.amount,
            cantidadBloqueada: existencia.cantidadBloqueada.amount,
            version: existencia.version, updatedAt: existencia.updatedAt },
        });
        if (result.count === 0) throw new Error(`OptimisticConcurrencyConflict: Existencia ${existencia.id.value}`);
      }

      await (tx as any).reserva.deleteMany({ where: { existenciaId: existencia.id.value } });
      for (const r of existencia.reservas) {
        await (tx as any).reserva.create({
          data: { id: r.id.value, existenciaId: existencia.id.value, tenantId: existencia.tenantId,
            referenciaTipo: r.referencia.tipo, referenciaId: r.referencia.id,
            cantidad: r.cantidad.amount, estado: r.estado,
            createdAt: r.createdAt, releasedAt: r.releasedAt, releasedReason: r.releasedReason },
        });
      }

      if (events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((e) => ({
            id: ulid(), tenantId: e.metadata.tenantId, aggregateType: e.metadata.aggregateType,
            aggregateId: e.metadata.aggregateId, eventType: e.metadata.eventType,
            eventVersion: e.metadata.eventVersion,
            payload: e.payload() as Prisma.InputJsonValue,
            metadata: { eventId: e.metadata.eventId, occurredAt: e.metadata.occurredAt.toISOString(),
              correlationId: this.ctx.getCorrelationId(), userId: this.ctx.tryGetUserId(),
            } as Prisma.InputJsonValue,
            occurredAt: e.metadata.occurredAt,
          })),
        });
      }
    });
  }

  private toDomain(row: any): Existencia | null {
    const dispR = Cantidad.create(Number(row.cantidadDisponible));
    const reservR = Cantidad.create(Number(row.cantidadReservada));
    const bloqR = Cantidad.create(Number(row.cantidadBloqueada));
    if (dispR.isErr || reservR.isErr || bloqR.isErr) { this.logger.error(`Invalid cantidades in Existencia ${row.id}`); return null; }
    const reservas: Reserva[] = [];
    for (const r of row.reservas ?? []) {
      const refR = ReferenciaOrigen.create(r.referenciaTipo as TipoReferencia, r.referenciaId);
      const cantR = Cantidad.create(Number(r.cantidad));
      if (refR.isErr || cantR.isErr) continue;
      reservas.push(Reserva.reconstitute({ id: ReservaId.fromString(r.id), referencia: refR.value,
        cantidad: cantR.value, estado: r.estado as EstadoReserva,
        createdAt: r.createdAt, releasedAt: r.releasedAt, releasedReason: r.releasedReason }));
    }
    return Existencia.reconstitute({ id: ExistenciaId.fromString(row.id), tenantId: row.tenantId,
      productId: row.productId, loteId: LoteId.fromString(row.loteId),
      locationId: LocationId.fromString(row.locationId),
      cantidadDisponible: dispR.value, cantidadReservada: reservR.value,
      cantidadBloqueada: bloqR.value, reservas,
      version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }
}
