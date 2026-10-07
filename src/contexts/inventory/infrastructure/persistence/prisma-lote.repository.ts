import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { newTimeOrderedUuid } from '@eliza/shared-kernel/domain';
import {
  Cantidad, CodigoLote, EstadoLote, FechaVencimiento,
  Lote, LoteId, LoteRepository, OrigenLote,
} from '@eliza/contexts/inventory/domain';

@Injectable()
export class PrismaLoteRepository implements LoteRepository {
  private readonly logger = new Logger(PrismaLoteRepository.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async findById(id: LoteId): Promise<Lote | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).lote.findUnique({ where: { id: id.value } });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByCodigoLote(productId: string, codigoLote: string): Promise<Lote | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).lote.findFirst({ where: { productId, codigoLote } });
      return row ? this.toDomain(row) : null;
    });
  }

  async findExpiringBefore(date: Date, limit: number): Promise<Lote[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).lote.findMany({
        where: { fechaVencimiento: { lte: date }, estado: { in: ['Disponible', 'Cuarentena'] } },
        orderBy: { fechaVencimiento: 'asc' }, take: limit,
      });
      return rows.map((r: any) => this.toDomain(r)).filter((l: Lote | null): l is Lote => l !== null);
    });
  }

  async findByProduct(productId: string, limit: number, offset: number): Promise<Lote[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).lote.findMany({
        where: { productId }, orderBy: { fechaVencimiento: 'asc' }, take: limit, skip: offset,
      });
      return rows.map((r: any) => this.toDomain(r)).filter((l: Lote | null): l is Lote => l !== null);
    });
  }

  async save(lote: Lote): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const events = lote.pullDomainEvents();
      const expectedVersion = lote.version - 1;

      if (lote.version === 1 && events.length > 0 && events[0].metadata.eventType === 'inventory.LotRegistered.v1') {
        await (tx as any).lote.create({
          data: {
            id: lote.id.value, tenantId: lote.tenantId, codigoLote: lote.codigoLote,
            productId: lote.productId, fechaProduccion: lote.fechaProduccion,
            fechaVencimiento: lote.fechaVencimiento.date, cantidadInicial: lote.cantidadInicial,
            estado: lote.estado, origenTipo: lote.origenTipo, origenRef: lote.origenRef,
            bloqueadoMotivo: lote.bloqueadoMotivo, bloqueadoPor: lote.bloqueadoPor,
            bloqueadoEn: lote.bloqueadoEn, notas: lote.notas,
            version: lote.version, createdAt: lote.createdAt, updatedAt: lote.updatedAt,
          },
        });
      } else {
        const result = await (tx as any).lote.updateMany({
          where: { id: lote.id.value, version: expectedVersion },
          data: { estado: lote.estado, bloqueadoMotivo: lote.bloqueadoMotivo,
            bloqueadoPor: lote.bloqueadoPor, bloqueadoEn: lote.bloqueadoEn,
            notas: lote.notas, version: lote.version, updatedAt: lote.updatedAt },
        });
        if (result.count === 0) throw new Error(`OptimisticConcurrencyConflict: Lote ${lote.id.value}`);
      }

      if (events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((e) => ({
            id: newTimeOrderedUuid(),
            tenantId: e.metadata.tenantId, aggregateType: e.metadata.aggregateType,
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

  private toDomain(row: any): Lote | null {
    const codR = CodigoLote.create(row.codigoLote);
    if (codR.isErr) { this.logger.error(`Invalid codigoLote: ${row.codigoLote}`); return null; }
    const cantR = Cantidad.create(Number(row.cantidadInicial));
    if (cantR.isErr) { this.logger.error(`Invalid cantidadInicial: ${row.cantidadInicial}`); return null; }
    return Lote.reconstitute({
      id: LoteId.fromString(row.id), tenantId: row.tenantId, codigoLote: codR.value,
      productId: row.productId, fechaProduccion: row.fechaProduccion,
      fechaVencimiento: FechaVencimiento.reconstitute(row.fechaVencimiento),
      cantidadInicial: cantR.value, estado: row.estado as EstadoLote,
      origenTipo: row.origenTipo as OrigenLote, origenRef: row.origenRef,
      bloqueadoMotivo: row.bloqueadoMotivo, bloqueadoPor: row.bloqueadoPor,
      bloqueadoEn: row.bloqueadoEn, notas: row.notas,
      version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt,
    });
  }
}
