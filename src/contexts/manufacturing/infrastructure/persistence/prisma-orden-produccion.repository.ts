import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { newTimeOrderedUuid } from '@eliza/shared-kernel/domain';
import {
  CantidadObjetivo,
  CodigoOrdenProduccion,
  ComponenteBomSnapshot,
  ConsumoMp,
  ConsumoMpId,
  EstadoOrdenProduccion,
  LoteProducido,
  LoteProducidoId,
  OrdenDeProduccion,
  OrdenProduccionFilter,
  OrdenProduccionId,
  OrdenProduccionRepository,
  PrioridadProduccion,
} from '@eliza/contexts/manufacturing/domain';

@Injectable()
export class PrismaOrdenProduccionRepository implements OrdenProduccionRepository {
  private readonly logger = new Logger(PrismaOrdenProduccionRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async findById(id: OrdenProduccionId): Promise<OrdenDeProduccion | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).ordenProduccion.findUnique({
        where: { id: id.value },
        include: { consumos: true, lotesProducidos: true },
      });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByCodigo(codigo: string): Promise<OrdenDeProduccion | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).ordenProduccion.findFirst({
        where: { codigo },
        include: { consumos: true, lotesProducidos: true },
      });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByProductoTerminado(
    productoTerminadoId: string, limit: number, offset: number,
  ): Promise<OrdenDeProduccion[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).ordenProduccion.findMany({
        where: { productoTerminadoId },
        include: { consumos: true, lotesProducidos: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });
      return rows
        .map((r: any) => this.toDomain(r))
        .filter((o: OrdenDeProduccion | null): o is OrdenDeProduccion => o !== null);
    });
  }

  async list(filter: OrdenProduccionFilter): Promise<OrdenDeProduccion[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).ordenProduccion.findMany({
        where: this.buildWhere(filter),
        include: { consumos: true, lotesProducidos: true },
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      });
      return rows
        .map((r: any) => this.toDomain(r))
        .filter((o: OrdenDeProduccion | null): o is OrdenDeProduccion => o !== null);
    });
  }

  async countBy(filter: OrdenProduccionFilter): Promise<number> {
    return this.prisma.withTenant(async (tx) => {
      return (tx as any).ordenProduccion.count({ where: this.buildWhere(filter) });
    });
  }

  async save(orden: OrdenDeProduccion): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const events = orden.pullDomainEvents();
      const expectedVersion = orden.version - 1;

      const existing = await (tx as any).ordenProduccion.findUnique({
        where: { id: orden.id.value },
        select: { id: true },
      });

      if (!existing) {
        // INSERT
        await (tx as any).ordenProduccion.create({
          data: {
            id: orden.id.value,
            tenantId: orden.tenantId,
            codigo: orden.codigo,
            productoTerminadoId: orden.productoTerminadoId,
            productoTerminadoCode: orden.productoTerminadoCode,
            productoTerminadoName: orden.productoTerminadoName,
            cantidadObjetivo: orden.cantidadObjetivo,
            estado: orden.estado,
            prioridad: orden.prioridad,
            componentes: orden.componentes as unknown as Prisma.InputJsonValue,
            materialesReservados: orden.materialesReservados,
            notas: orden.notas,
            jornada: orden.jornada,
            canceladoMotivo: orden.canceladoMotivo,
            canceladoPor: orden.canceladoPor,
            canceladoEn: orden.canceladoEn,
            fechaProgramada: orden.fechaProgramada,
            iniciadoEn: orden.iniciadoEn,
            completadoEn: orden.completadoEn,
            cerradoEn: orden.cerradoEn,
            version: orden.version,
            createdAt: orden.createdAt,
            updatedAt: orden.updatedAt,
          },
        });
      } else {
        // UPDATE con optimistic concurrency
        const result = await (tx as any).ordenProduccion.updateMany({
          where: { id: orden.id.value, version: expectedVersion },
          data: {
            estado: orden.estado,
            prioridad: orden.prioridad,
            materialesReservados: orden.materialesReservados,
            notas: orden.notas,
            canceladoMotivo: orden.canceladoMotivo,
            canceladoPor: orden.canceladoPor,
            canceladoEn: orden.canceladoEn,
            iniciadoEn: orden.iniciadoEn,
            completadoEn: orden.completadoEn,
            cerradoEn: orden.cerradoEn,
            version: orden.version,
            updatedAt: orden.updatedAt,
          },
        });
        if (result.count === 0) {
          throw new Error(`OptimisticConcurrencyConflict: OrdenProduccion ${orden.id.value}`);
        }
      }

      // Consumos: delete all + recreate (patrón entidades anidadas)
      await (tx as any).consumoMp.deleteMany({ where: { ordenProduccionId: orden.id.value } });
      for (const c of orden.consumos) {
        await (tx as any).consumoMp.create({
          data: {
            id: c.id.value,
            ordenProduccionId: orden.id.value,
            tenantId: orden.tenantId,
            productId: c.productId,
            productCode: c.productCode,
            loteId: c.loteId,
            codigoLote: c.codigoLote,
            cantidad: c.cantidad,
            unidadMedida: c.unidadMedida,
            movimientoId: c.movimientoId,
            consumidoEn: c.consumidoEn,
          },
        });
      }

      // Lotes producidos: delete all + recreate
      await (tx as any).loteProducido.deleteMany({ where: { ordenProduccionId: orden.id.value } });
      for (const lp of orden.lotesProducidos) {
        await (tx as any).loteProducido.create({
          data: {
            id: lp.id.value,
            ordenProduccionId: orden.id.value,
            tenantId: orden.tenantId,
            loteId: lp.loteId,
            codigoLote: lp.codigoLote,
            productId: lp.productId,
            cantidad: lp.cantidad,
            locationId: lp.locationId,
            movimientoId: lp.movimientoId,
            producidoEn: lp.producidoEn,
          },
        });
      }

      // Drenar eventos al outbox
      if (events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((e) => ({
            id: newTimeOrderedUuid(),
            tenantId: e.metadata.tenantId,
            aggregateType: e.metadata.aggregateType,
            aggregateId: e.metadata.aggregateId,
            eventType: e.metadata.eventType,
            eventVersion: e.metadata.eventVersion,
            payload: e.payload() as Prisma.InputJsonValue,
            metadata: {
              eventId: e.metadata.eventId,
              occurredAt: e.metadata.occurredAt.toISOString(),
              correlationId: this.ctx.getCorrelationId(),
              userId: this.ctx.tryGetUserId(),
            } as Prisma.InputJsonValue,
            occurredAt: e.metadata.occurredAt,
          })),
        });
      }
    });
  }

  // ---------- Helpers ----------

  private buildWhere(filter: OrdenProduccionFilter): any {
    const where: any = {};
    if (filter.estado) where.estado = filter.estado;
    if (filter.productoTerminadoId) where.productoTerminadoId = filter.productoTerminadoId;
    if (filter.prioridad) where.prioridad = filter.prioridad;
    if (filter.jornada) where.jornada = filter.jornada;
    else if (filter.soloJornadas) where.jornada = { not: null };
    if (filter.fechaProgramadaDesde || filter.fechaProgramadaHasta) {
      where.fechaProgramada = {};
      if (filter.fechaProgramadaDesde) where.fechaProgramada.gte = filter.fechaProgramadaDesde;
      if (filter.fechaProgramadaHasta) where.fechaProgramada.lte = filter.fechaProgramadaHasta;
    }
    return where;
  }

  private toDomain(row: any): OrdenDeProduccion | null {
    const codigoR = CodigoOrdenProduccion.create(row.codigo);
    if (codigoR.isErr) {
      this.logger.error(`Invalid codigo in DB: ${row.codigo}`);
      return null;
    }

    const cantR = CantidadObjetivo.create(Number(row.cantidadObjetivo));
    if (cantR.isErr) {
      this.logger.error(`Invalid cantidadObjetivo in DB: ${row.cantidadObjetivo}`);
      return null;
    }

    // Reconstituir componentes desde JSON
    const componentes: ComponenteBomSnapshot[] = Array.isArray(row.componentes)
      ? row.componentes
      : [];

    // Reconstituir consumos
    const consumos: ConsumoMp[] = (row.consumos ?? []).map((c: any) =>
      ConsumoMp.reconstitute({
        id: ConsumoMpId.fromString(c.id),
        productId: c.productId,
        productCode: c.productCode,
        loteId: c.loteId,
        codigoLote: c.codigoLote,
        cantidad: Number(c.cantidad),
        unidadMedida: c.unidadMedida,
        movimientoId: c.movimientoId,
        consumidoEn: c.consumidoEn,
      }),
    );

    // Reconstituir lotes producidos
    const lotesProducidos: LoteProducido[] = (row.lotesProducidos ?? []).map((lp: any) =>
      LoteProducido.reconstitute({
        id: LoteProducidoId.fromString(lp.id),
        loteId: lp.loteId,
        codigoLote: lp.codigoLote,
        productId: lp.productId,
        cantidad: Number(lp.cantidad),
        locationId: lp.locationId,
        movimientoId: lp.movimientoId,
        producidoEn: lp.producidoEn,
      }),
    );

    return OrdenDeProduccion.reconstitute({
      id: OrdenProduccionId.fromString(row.id),
      tenantId: row.tenantId,
      codigo: codigoR.value,
      productoTerminadoId: row.productoTerminadoId,
      productoTerminadoCode: row.productoTerminadoCode,
      productoTerminadoName: row.productoTerminadoName,
      cantidadObjetivo: cantR.value,
      estado: row.estado as EstadoOrdenProduccion,
      prioridad: row.prioridad as PrioridadProduccion,
      componentes,
      materialesReservados: row.materialesReservados,
      consumos,
      lotesProducidos,
      notas: row.notas,
      jornada: row.jornada ?? null,
      canceladoMotivo: row.canceladoMotivo,
      canceladoPor: row.canceladoPor,
      canceladoEn: row.canceladoEn,
      fechaProgramada: row.fechaProgramada,
      iniciadoEn: row.iniciadoEn,
      completadoEn: row.completadoEn,
      cerradoEn: row.cerradoEn,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}