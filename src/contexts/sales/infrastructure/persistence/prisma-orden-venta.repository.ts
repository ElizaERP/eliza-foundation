import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { newTimeOrderedUuid } from '@eliza/shared-kernel/domain';
import {
  CodigoPedido,
  CondicionesPago,
  DireccionEntrega,
  EstadoOrdenVenta,
  LineaPedido,
  LineaPedidoId,
  OrdenDeVenta,
  OrdenVentaFilter,
  OrdenVentaId,
  OrdenVentaRepository,
  PrecioUnitario,
} from '@eliza/contexts/sales/domain';

@Injectable()
export class PrismaOrdenVentaRepository implements OrdenVentaRepository {
  private readonly logger = new Logger(PrismaOrdenVentaRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async findById(id: OrdenVentaId): Promise<OrdenDeVenta | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).ordenVenta.findUnique({
        where: { id: id.value },
        include: { lineas: { orderBy: { position: 'asc' } } },
      });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByCodigo(codigo: string): Promise<OrdenDeVenta | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).ordenVenta.findFirst({
        where: { codigo },
        include: { lineas: { orderBy: { position: 'asc' } } },
      });
      return row ? this.toDomain(row) : null;
    });
  }

  async findByCliente(clienteId: string, limit: number, offset: number): Promise<OrdenDeVenta[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).ordenVenta.findMany({
        where: { clienteId },
        include: { lineas: { orderBy: { position: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });
      return rows
        .map((r: any) => this.toDomain(r))
        .filter((o: OrdenDeVenta | null): o is OrdenDeVenta => o !== null);
    });
  }

  async list(filter: OrdenVentaFilter): Promise<OrdenDeVenta[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).ordenVenta.findMany({
        where: this.buildWhere(filter),
        include: { lineas: { orderBy: { position: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      });
      return rows
        .map((r: any) => this.toDomain(r))
        .filter((o: OrdenDeVenta | null): o is OrdenDeVenta => o !== null);
    });
  }

  async countBy(filter: OrdenVentaFilter): Promise<number> {
    return this.prisma.withTenant(async (tx) => {
      return (tx as any).ordenVenta.count({ where: this.buildWhere(filter) });
    });
  }

  async save(orden: OrdenDeVenta): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const events = orden.pullDomainEvents();
      const expectedVersion = orden.version - 1;

      const existing = await (tx as any).ordenVenta.findUnique({
        where: { id: orden.id.value },
        select: { id: true },
      });

      if (!existing) {
        // INSERT
        await (tx as any).ordenVenta.create({
          data: {
            id: orden.id.value,
            tenantId: orden.tenantId,
            codigo: orden.codigo,
            clienteId: orden.clienteId,
            clienteCodigo: orden.clienteCodigo,
            clienteRazonSocial: orden.clienteRazonSocial,
            estado: orden.estado,
            condicionesPago: orden.condicionesPago,
            direccionEntrega: orden.direccionEntrega.toJson() as Prisma.InputJsonValue,
            subtotal: orden.subtotal,
            ivaTotal: orden.ivaTotal,
            total: orden.total,
            notas: orden.notas,
            canceladoMotivo: orden.canceladoMotivo,
            canceladoPor: orden.canceladoPor,
            canceladoEn: orden.canceladoEn,
            confirmadoEn: orden.confirmadoEn,
            reservadoEn: orden.reservadoEn,
            despachadoEn: orden.despachadoEn,
            cerradoEn: orden.cerradoEn,
            version: orden.version,
            createdAt: orden.createdAt,
            updatedAt: orden.updatedAt,
          },
        });
      } else {
        // UPDATE con optimistic concurrency
        const result = await (tx as any).ordenVenta.updateMany({
          where: { id: orden.id.value, version: expectedVersion },
          data: {
            estado: orden.estado,
            subtotal: orden.subtotal,
            ivaTotal: orden.ivaTotal,
            total: orden.total,
            notas: orden.notas,
            canceladoMotivo: orden.canceladoMotivo,
            canceladoPor: orden.canceladoPor,
            canceladoEn: orden.canceladoEn,
            confirmadoEn: orden.confirmadoEn,
            reservadoEn: orden.reservadoEn,
            despachadoEn: orden.despachadoEn,
            cerradoEn: orden.cerradoEn,
            version: orden.version,
            updatedAt: orden.updatedAt,
          },
        });
        if (result.count === 0) {
          throw new Error(`OptimisticConcurrencyConflict: OrdenVenta ${orden.id.value}`);
        }
      }

      // Líneas: delete all + recreate (patrón entidades anidadas)
      await (tx as any).lineaPedido.deleteMany({ where: { ordenVentaId: orden.id.value } });
      let position = 0;
      for (const l of orden.lineas) {
        await (tx as any).lineaPedido.create({
          data: {
            id: l.id.value,
            ordenVentaId: orden.id.value,
            tenantId: orden.tenantId,
            productId: l.productId,
            productCode: l.productCode,
            productName: l.productName,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario,
            tasaIva: l.tasaIva,
            subtotal: l.subtotal,
            iva: l.iva,
            total: l.total,
            position,
            notas: l.notas,
          },
        });
        position++;
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

  private buildWhere(filter: OrdenVentaFilter): any {
    const where: any = {};
    if (filter.estado) where.estado = filter.estado;
    if (filter.clienteId) where.clienteId = filter.clienteId;
    if (filter.creadoDesde || filter.creadoHasta) {
      where.createdAt = {};
      if (filter.creadoDesde) where.createdAt.gte = filter.creadoDesde;
      if (filter.creadoHasta) where.createdAt.lte = filter.creadoHasta;
    }
    return where;
  }

  private toDomain(row: any): OrdenDeVenta | null {
    const codigoR = CodigoPedido.create(row.codigo);
    if (codigoR.isErr) {
      this.logger.error(`Invalid codigo in DB: ${row.codigo}`);
      return null;
    }

    const dirEntrega = DireccionEntrega.fromJson(row.direccionEntrega);

    // Reconstituir líneas
    const lineas: LineaPedido[] = (row.lineas ?? []).map((l: any) => {
      const precioR = PrecioUnitario.create(Number(l.precioUnitario));
      if (precioR.isErr) {
        this.logger.error(`Invalid precioUnitario in LineaPedido ${l.id}`);
        return null;
      }
      return LineaPedido.reconstitute({
        id: LineaPedidoId.fromString(l.id),
        productId: l.productId,
        productCode: l.productCode,
        productName: l.productName,
        cantidad: Number(l.cantidad),
        precioUnitario: precioR.value,
        tasaIva: Number(l.tasaIva),
        subtotal: Number(l.subtotal),
        iva: Number(l.iva),
        total: Number(l.total),
        notas: l.notas,
      });
    }).filter((l: LineaPedido | null): l is LineaPedido => l !== null);

    return OrdenDeVenta.reconstitute({
      id: OrdenVentaId.fromString(row.id),
      tenantId: row.tenantId,
      codigo: codigoR.value,
      clienteId: row.clienteId,
      clienteCodigo: row.clienteCodigo,
      clienteRazonSocial: row.clienteRazonSocial,
      estado: row.estado as EstadoOrdenVenta,
      condicionesPago: row.condicionesPago as CondicionesPago,
      direccionEntrega: dirEntrega,
      lineas,
      subtotal: Number(row.subtotal),
      ivaTotal: Number(row.ivaTotal),
      total: Number(row.total),
      notas: row.notas,
      canceladoMotivo: row.canceladoMotivo,
      canceladoPor: row.canceladoPor,
      canceladoEn: row.canceladoEn,
      confirmadoEn: row.confirmadoEn,
      reservadoEn: row.reservadoEn,
      despachadoEn: row.despachadoEn,
      cerradoEn: row.cerradoEn,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}