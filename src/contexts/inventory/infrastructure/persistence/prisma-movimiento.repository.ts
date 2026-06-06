import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import {
  Cantidad, LocationId, LoteId, MovimientoId, MovimientoInventario,
  MovimientoQueryFilter, MovimientoRepository, ReferenciaOrigen, TipoMovimiento, TipoReferencia,
} from '@eliza/contexts/inventory/domain';

@Injectable()
export class PrismaMovimientoRepository implements MovimientoRepository {
  private readonly logger = new Logger(PrismaMovimientoRepository.name);
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: MovimientoId): Promise<MovimientoInventario | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).movimientoInventario.findUnique({ where: { id: id.value } });
      return row ? this.toDomain(row) : null;
    });
  }

  async query(filter: MovimientoQueryFilter): Promise<MovimientoInventario[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).movimientoInventario.findMany({
        where: this.buildWhere(filter),
        orderBy: [{ ocurridoEn: 'desc' }, { createdAt: 'desc' }],
        take: filter.limit, skip: filter.offset,
      });
      return rows.map((r: any) => this.toDomain(r)).filter((m: MovimientoInventario | null): m is MovimientoInventario => m !== null);
    });
  }

  async countBy(filter: MovimientoQueryFilter): Promise<number> {
    return this.prisma.withTenant(async (tx) => {
      return (tx as any).movimientoInventario.count({ where: this.buildWhere(filter) });
    });
  }

  async append(movimiento: MovimientoInventario): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      await (tx as any).movimientoInventario.create({
        data: {
          id: movimiento.id.value, tenantId: movimiento.tenantId, tipo: movimiento.tipo,
          productId: movimiento.productId, loteId: movimiento.loteId?.value ?? null,
          locationId: movimiento.locationId.value, locationDestinoId: movimiento.locationDestinoId?.value ?? null,
          cantidad: movimiento.cantidad.amount, referenciaTipo: movimiento.referencia.tipo,
          referenciaId: movimiento.referencia.id, motivo: movimiento.motivo,
          ocurridoEn: movimiento.ocurridoEn, registradoPor: movimiento.registradoPor, createdAt: movimiento.createdAt,
        },
      });
    });
  }

  private buildWhere(filter: MovimientoQueryFilter): any {
    const where: any = {};
    if (filter.productId) where.productId = filter.productId;
    if (filter.loteId) where.loteId = filter.loteId;
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.tipo) where.tipo = filter.tipo;
    if (filter.referenciaId) where.referenciaId = filter.referenciaId;
    if (filter.ocurridoDesde || filter.ocurridoHasta) {
      where.ocurridoEn = {};
      if (filter.ocurridoDesde) where.ocurridoEn.gte = filter.ocurridoDesde;
      if (filter.ocurridoHasta) where.ocurridoEn.lte = filter.ocurridoHasta;
    }
    return where;
  }

  private toDomain(row: any): MovimientoInventario | null {
    const cantR = Cantidad.create(Number(row.cantidad));
    if (cantR.isErr) { this.logger.error(`Invalid cantidad in Movimiento ${row.id}`); return null; }
    const refR = ReferenciaOrigen.create(row.referenciaTipo as TipoReferencia, row.referenciaId);
    if (refR.isErr) { this.logger.error(`Invalid referencia in Movimiento ${row.id}`); return null; }
    return MovimientoInventario.reconstitute({
      id: MovimientoId.fromString(row.id), tenantId: row.tenantId, tipo: row.tipo as TipoMovimiento,
      productId: row.productId, loteId: row.loteId ? LoteId.fromString(row.loteId) : null,
      locationId: LocationId.fromString(row.locationId),
      locationDestinoId: row.locationDestinoId ? LocationId.fromString(row.locationDestinoId) : null,
      cantidad: cantR.value, referencia: refR.value, motivo: row.motivo,
      ocurridoEn: row.ocurridoEn, registradoPor: row.registradoPor, createdAt: row.createdAt,
    });
  }
}
