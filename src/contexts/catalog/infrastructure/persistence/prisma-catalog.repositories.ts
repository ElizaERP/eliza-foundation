import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';

import {
  Category,
  CategoryId,
  CategoryRepository,
  EntityName,
  UnitOfMeasure,
  UnitOfMeasureId,
  UnitOfMeasureRepository,
  UomDimension,
} from '../../domain';

@Injectable()
export class PrismaCategoryRepository implements CategoryRepository {
  private readonly logger = new Logger(PrismaCategoryRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async save(category: Category, expectedVersion?: number): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.category.findUnique({ where: { id: category.id.value } });

      if (!existing) {
        await tx.category.create({
          data: {
            id: category.id.value,
            tenantId: category.tenantId,
            code: category.code,
            name: category.name,
            description: category.description,
            parentId: category.parentId?.value ?? null,
            path: category.path,
            isActive: category.isActive,
            version: category.version,
            createdAt: category.createdAt,
          },
        });
      } else {
        const target = expectedVersion ?? category.version - 1;
        const result = await tx.category.updateMany({
          where: { id: category.id.value, version: target },
          data: {
            name: category.name,
            description: category.description,
            isActive: category.isActive,
            version: category.version,
            updatedAt: category.updatedAt,
          },
        });
        if (result.count === 0) {
          throw new Error(`Category ${category.id.value} version mismatch (expected ${target})`);
        }
      }

      const events = category.pullDomainEvents();
      if (events.length > 0) {
        const { ulid } = await import('ulid');
        await tx.outboxEvent.createMany({
          data: events.map((e) => ({
            id: ulid(),
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

  async findById(categoryId: string): Promise<Category | null> {
    const row = await this.prisma.withTenant((tx) =>
      tx.category.findUnique({ where: { id: categoryId } }),
    );
    return row ? this.toDomain(row) : null;
  }

  async findByCode(code: string): Promise<Category | null> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const row = await this.prisma.withTenant((tx) =>
      tx.category.findFirst({ where: { tenantId, code } }),
    );
    return row ? this.toDomain(row) : null;
  }

  async findChildren(parentId: string | null): Promise<Category[]> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const rows = await this.prisma.withTenant((tx) =>
      tx.category.findMany({ where: { tenantId, parentId }, orderBy: { code: 'asc' } }),
    );
    return rows.map((r) => this.toDomain(r));
  }

  async listAll(args: { tenantId: string; activeOnly?: boolean }): Promise<Category[]> {
    const rows = await this.prisma.withTenant((tx) =>
      tx.category.findMany({
        where: {
          tenantId: args.tenantId,
          ...(args.activeOnly ? { isActive: true } : {}),
        },
        orderBy: { path: 'asc' },
      }),
    );
    return rows.map((r) => this.toDomain(r));
  }

  private toDomain(row: Prisma.CategoryGetPayload<object>): Category {
    const nameR = EntityName.create(row.name, 'categoryName');
    if (nameR.isErr) throw new Error(`Persisted category ${row.id} has invalid name`);
    return Category.reconstitute({
      id: CategoryId.fromString(row.id),
      tenantId: row.tenantId,
      code: row.code,
      name: nameR.value,
      description: row.description,
      parentId: row.parentId ? CategoryId.fromString(row.parentId) : null,
      path: row.path,
      isActive: row.isActive,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}

@Injectable()
export class PrismaUnitOfMeasureRepository implements UnitOfMeasureRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(uomId: string): Promise<UnitOfMeasure | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.unitOfMeasure.findUnique({ where: { id: uomId } }),
      'UoM read — cross-tenant catalog',
    );
    return row ? this.toDomain(row) : null;
  }

  async findByCode(code: string): Promise<UnitOfMeasure | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.unitOfMeasure.findUnique({ where: { code } }),
      'UoM lookup by code',
    );
    return row ? this.toDomain(row) : null;
  }

  async findByIds(ids: string[]): Promise<UnitOfMeasure[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.unitOfMeasure.findMany({ where: { id: { in: ids } } }),
      'UoM batch lookup',
    );
    return rows.map((r) => this.toDomain(r));
  }

  async listAll(args?: { dimension?: string; activeOnly?: boolean }): Promise<UnitOfMeasure[]> {
    const rows = await this.prisma.unsafeWithoutTenant(
      (tx) =>
        tx.unitOfMeasure.findMany({
          where: {
            ...(args?.dimension ? { dimension: args.dimension as never } : {}),
            ...(args?.activeOnly ? { isActive: true } : {}),
          },
          orderBy: [{ dimension: 'asc' }, { code: 'asc' }],
        }),
      'UoM list catalog',
    );
    return rows.map((r) => this.toDomain(r));
  }

  private toDomain(row: Prisma.UnitOfMeasureGetPayload<object>): UnitOfMeasure {
    const nameR = EntityName.create(row.name, 'uomName');
    if (nameR.isErr) throw new Error(`Persisted UoM ${row.id} has invalid name`);
    return UnitOfMeasure.reconstitute(
      UnitOfMeasureId.fromString(row.id),
      {
        code: row.code,
        name: nameR.value,
        symbol: row.symbol,
        dimension: row.dimension as UomDimension,
        toBaseFactor: Number(row.toBaseFactor),
        isActive: row.isActive,
      },
    );
  }
}
