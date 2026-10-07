import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { newTimeOrderedUuid } from '@eliza/shared-kernel/domain';
import {
  Location, LocationId, LocationRepository, TipoUbicacion,
  Warehouse, WarehouseId, WarehouseRepository,
} from '@eliza/contexts/inventory/domain';

@Injectable()
export class PrismaWarehouseRepository implements WarehouseRepository {
  private readonly logger = new Logger(PrismaWarehouseRepository.name);
  constructor(private readonly prisma: PrismaService, @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort) {}

  async findById(id: WarehouseId): Promise<Warehouse | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).warehouse.findUnique({ where: { id: id.value } });
      return row ? this.toDomain(row) : null;
    });
  }
  async findByCode(code: string): Promise<Warehouse | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).warehouse.findFirst({ where: { code } });
      return row ? this.toDomain(row) : null;
    });
  }
  async list(activeOnly: boolean): Promise<Warehouse[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).warehouse.findMany({ where: activeOnly ? { isActive: true } : {}, orderBy: { code: 'asc' } });
      return rows.map((r: any) => this.toDomain(r)).filter((w: Warehouse | null): w is Warehouse => w !== null);
    });
  }
  async save(warehouse: Warehouse): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const events = warehouse.pullDomainEvents();
      if (warehouse.version === 1) {
        await (tx as any).warehouse.create({ data: { id: warehouse.id.value, tenantId: warehouse.tenantId,
          code: warehouse.code, name: warehouse.name, address: warehouse.address,
          isActive: warehouse.isActive, version: warehouse.version, createdAt: warehouse.createdAt, updatedAt: warehouse.updatedAt } });
      } else {
        const result = await (tx as any).warehouse.updateMany({ where: { id: warehouse.id.value, version: warehouse.version - 1 },
          data: { name: warehouse.name, address: warehouse.address, isActive: warehouse.isActive,
            version: warehouse.version, updatedAt: warehouse.updatedAt } });
        if (result.count === 0) throw new Error(`OptimisticConcurrencyConflict: Warehouse ${warehouse.id.value}`);
      }
      if (events.length > 0) {
        await tx.outboxEvent.createMany({ data: events.map((e) => ({
          id: newTimeOrderedUuid(), tenantId: e.metadata.tenantId, aggregateType: e.metadata.aggregateType,
          aggregateId: e.metadata.aggregateId, eventType: e.metadata.eventType, eventVersion: e.metadata.eventVersion,
          payload: e.payload() as Prisma.InputJsonValue,
          metadata: { eventId: e.metadata.eventId, occurredAt: e.metadata.occurredAt.toISOString(),
            correlationId: this.ctx.getCorrelationId(), userId: this.ctx.tryGetUserId() } as Prisma.InputJsonValue,
          occurredAt: e.metadata.occurredAt,
        })) });
      }
    });
  }
  private toDomain(row: any): Warehouse | null {
    return Warehouse.reconstitute({ id: WarehouseId.fromString(row.id), tenantId: row.tenantId,
      code: row.code, name: row.name, address: row.address, isActive: row.isActive,
      version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }
}

@Injectable()
export class PrismaLocationRepository implements LocationRepository {
  private readonly logger = new Logger(PrismaLocationRepository.name);
  constructor(private readonly prisma: PrismaService, @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort) {}

  async findById(id: LocationId): Promise<Location | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).location.findUnique({ where: { id: id.value } });
      return row ? this.toDomain(row) : null;
    });
  }
  async findByCode(warehouseId: string, code: string): Promise<Location | null> {
    return this.prisma.withTenant(async (tx) => {
      const row = await (tx as any).location.findFirst({ where: { warehouseId, code } });
      return row ? this.toDomain(row) : null;
    });
  }
  async listByWarehouse(warehouseId: string, activeOnly: boolean): Promise<Location[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await (tx as any).location.findMany({ where: { warehouseId, ...(activeOnly ? { isActive: true } : {}) }, orderBy: { code: 'asc' } });
      return rows.map((r: any) => this.toDomain(r)).filter((l: Location | null): l is Location => l !== null);
    });
  }
  async save(location: Location): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const events = location.pullDomainEvents();
      if (location.version === 1) {
        await (tx as any).location.create({ data: { id: location.id.value, tenantId: location.tenantId,
          warehouseId: location.warehouseId.value, code: location.code, name: location.name,
          tipoUbicacion: location.tipoUbicacion, tempMinC: location.tempMinC, tempMaxC: location.tempMaxC,
          capacidadMax: location.capacidadMax, isActive: location.isActive,
          version: location.version, createdAt: location.createdAt, updatedAt: location.updatedAt } });
      } else {
        const result = await (tx as any).location.updateMany({ where: { id: location.id.value, version: location.version - 1 },
          data: { name: location.name, tempMinC: location.tempMinC, tempMaxC: location.tempMaxC,
            capacidadMax: location.capacidadMax, isActive: location.isActive,
            version: location.version, updatedAt: location.updatedAt } });
        if (result.count === 0) throw new Error(`OptimisticConcurrencyConflict: Location ${location.id.value}`);
      }
      if (events.length > 0) {
        await tx.outboxEvent.createMany({ data: events.map((e) => ({
          id: newTimeOrderedUuid(), tenantId: e.metadata.tenantId, aggregateType: e.metadata.aggregateType,
          aggregateId: e.metadata.aggregateId, eventType: e.metadata.eventType, eventVersion: e.metadata.eventVersion,
          payload: e.payload() as Prisma.InputJsonValue,
          metadata: { eventId: e.metadata.eventId, occurredAt: e.metadata.occurredAt.toISOString(),
            correlationId: this.ctx.getCorrelationId(), userId: this.ctx.tryGetUserId() } as Prisma.InputJsonValue,
          occurredAt: e.metadata.occurredAt,
        })) });
      }
    });
  }
  private toDomain(row: any): Location | null {
    return Location.reconstitute({ id: LocationId.fromString(row.id), tenantId: row.tenantId,
      warehouseId: WarehouseId.fromString(row.warehouseId), code: row.code, name: row.name,
      tipoUbicacion: row.tipoUbicacion as TipoUbicacion, tempMinC: row.tempMinC, tempMaxC: row.tempMaxC,
      capacidadMax: row.capacidadMax, isActive: row.isActive,
      version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }
}
