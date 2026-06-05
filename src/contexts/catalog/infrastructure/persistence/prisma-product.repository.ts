import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ulid } from 'ulid';
import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { Inject } from '@nestjs/common';

import {
  BOMComponent,
  Barcode,
  CategoryId,
  EntityName,
  Product,
  ProductCode,
  ProductId,
  ProductQueryFilter,
  ProductQueryResult,
  ProductRepository,
  ProductStatus,
  ProductType,
  Quantity,
  Sku,
  TemperatureRange,
  UnitOfMeasureId,
  Weight,
  BOMComponentId,
} from '../../domain';

/**
 * PrismaProductRepository — adapter completo.
 *
 *  - save() upsert atómico: aggregate + BOM components + outbox events
 *  - Optimistic concurrency: UPDATE WHERE version = expectedVersion;
 *    si count = 0 → 412 Precondition Failed
 *  - findByIds para validar BOM (evita N+1 queries)
 *  - search es ILIKE en name+sku+code+barcode
 */
@Injectable()
export class PrismaProductRepository implements ProductRepository {
  private readonly logger = new Logger(PrismaProductRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async save(product: Product, expectedVersion?: number): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const isNew = product.version === 1 && (await tx.product.count({
        where: { id: product.id.value },
      })) === 0;

      if (isNew) {
        await tx.product.create({ data: this.toCreateData(product) });
      } else {
        const target = expectedVersion ?? product.version - 1;
        const result = await tx.product.updateMany({
          where: { id: product.id.value, version: target },
          data: this.toUpdateData(product),
        });
        if (result.count === 0) {
          throw new ProductVersionMismatchError(product.id.value, target);
        }
      }

      // Reemplazar componentes BOM (delete + insert es más simple que diff)
      await tx.bOMComponent.deleteMany({
        where: { tenantId: product.tenantId, productId: product.id.value },
      });
      if (product.components.length > 0) {
        await tx.bOMComponent.createMany({
          data: product.components.map((c) => ({
            id: c.id.value,
            tenantId: product.tenantId,
            productId: product.id.value,
            componentId: c.componentProductId.value,
            quantity: new Prisma.Decimal(c.quantity.amount),
            uomId: c.uomId.value,
            position: c.position,
            notes: c.notes,
          })),
        });
      }

      // Drenar eventos al outbox
      const events = product.pullDomainEvents();
      if (events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((e) => ({
            id: ulid(),
            tenantId: e.tenantId,
            aggregateType: e.aggregateType,
            aggregateId: e.aggregateId,
            eventType: e.type,
            eventVersion: e.version,
            payload: e.payload as Prisma.InputJsonValue,
            metadata: {
              eventId: e.eventId ?? ulid(),
              occurredAt: e.occurredAt.toISOString(),
              correlationId: this.ctx.getCorrelationId(),
              userId: this.ctx.tryGetUserId(),
            } as Prisma.InputJsonValue,
            occurredAt: e.occurredAt,
          })),
        });
      }
    });
  }

  async findById(productId: string): Promise<Product | null> {
    const row = await this.prisma.withTenant((tx) => tx.product.findUnique({
      where: { id: productId },
      include: { components: { orderBy: { position: 'asc' } } },
    }));
    return row ? this.toDomain(row) : null;
  }

  async findByCode(code: string): Promise<Product | null> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const row = await this.prisma.withTenant((tx) => tx.product.findFirst({
      where: { tenantId, code },
      include: { components: { orderBy: { position: 'asc' } } },
    }));
    return row ? this.toDomain(row) : null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const row = await this.prisma.withTenant((tx) => tx.product.findFirst({
      where: { tenantId, sku },
      include: { components: { orderBy: { position: 'asc' } } },
    }));
    return row ? this.toDomain(row) : null;
  }

  async findByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.withTenant((tx) => tx.product.findMany({
      where: { id: { in: ids } },
      include: { components: { orderBy: { position: 'asc' } } },
    }));
    return rows.map((r) => this.toDomain(r));
  }

  async query(filter: ProductQueryFilter): Promise<ProductQueryResult> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 25, 100);

    const where: Prisma.ProductWhereInput = { tenantId: filter.tenantId };
    if (filter.status?.length) where.status = { in: filter.status };
    if (filter.type?.length) where.type = { in: filter.type };
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.isControlled !== undefined) where.isControlled = filter.isControlled;
    if (filter.categoryPathPrefix) {
      where.category = { path: { startsWith: filter.categoryPathPrefix } };
    }

    const [rows, total] = await this.prisma.withTenant((tx) => Promise.all([
      tx.product.findMany({
        where,
        include: { components: { orderBy: { position: 'asc' } } },
        orderBy: [{ status: 'asc' }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      tx.product.count({ where }),
    ]));

    return {
      items: rows.map((r) => this.toDomain(r)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async search(args: { tenantId: string; q: string; limit?: number }): Promise<Product[]> {
    const q = `%${args.q}%`;
    const rows = await this.prisma.withTenant((tx) => tx.product.findMany({
      where: {
        tenantId: args.tenantId,
        OR: [
          { name:    { contains: args.q, mode: 'insensitive' } },
          { code:    { contains: args.q, mode: 'insensitive' } },
          { sku:     { contains: args.q, mode: 'insensitive' } },
          { barcode: { contains: args.q, mode: 'insensitive' } },
        ],
      },
      include: { components: { orderBy: { position: 'asc' } } },
      take: args.limit ?? 25,
    }));
    return rows.map((r) => this.toDomain(r));
  }

  // ---------- Mappers ----------
  private toCreateData(p: Product): Prisma.ProductUncheckedCreateInput {
    return {
      id: p.id.value,
      tenantId: p.tenantId,
      code: p.code,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      description: p.description,
      type: p.type,
      status: p.status,
      categoryId: p.categoryId.value,
      unitOfSaleId: p.unitOfSaleId.value,
      packSize: p.packSize,
      netWeightGrams: p.netWeight ? new Prisma.Decimal(p.netWeight.grams) : null,
      grossWeightGrams: p.grossWeight ? new Prisma.Decimal(p.grossWeight.grams) : null,
      expiryDays: p.expiryDays,
      storageTempMinC: p.storageTemperature ? new Prisma.Decimal(p.storageTemperature.minC) : null,
      storageTempMaxC: p.storageTemperature ? new Prisma.Decimal(p.storageTemperature.maxC) : null,
      taxRate: p.taxRate !== null ? new Prisma.Decimal(p.taxRate) : null,
      imageUrl: p.imageUrl,
      isControlled: p.isControlled,
      version: p.version,
      createdAt: p.createdAt,
    };
  }

  private toUpdateData(p: Product): Prisma.ProductUncheckedUpdateInput {
    return {
      code: p.code,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      description: p.description,
      type: p.type,
      status: p.status,
      categoryId: p.categoryId.value,
      unitOfSaleId: p.unitOfSaleId.value,
      packSize: p.packSize,
      netWeightGrams: p.netWeight ? new Prisma.Decimal(p.netWeight.grams) : null,
      grossWeightGrams: p.grossWeight ? new Prisma.Decimal(p.grossWeight.grams) : null,
      expiryDays: p.expiryDays,
      storageTempMinC: p.storageTemperature ? new Prisma.Decimal(p.storageTemperature.minC) : null,
      storageTempMaxC: p.storageTemperature ? new Prisma.Decimal(p.storageTemperature.maxC) : null,
      taxRate: p.taxRate !== null ? new Prisma.Decimal(p.taxRate) : null,
      imageUrl: p.imageUrl,
      isControlled: p.isControlled,
      version: p.version,
      updatedAt: p.updatedAt,
    };
  }

  private toDomain(row: Prisma.ProductGetPayload<{ include: { components: true } }>): Product {
    const codeR = ProductCode.create(row.code);
    const skuR = Sku.create(row.sku);
    const nameR = EntityName.create(row.name, 'productName');
    if (codeR.isErr || skuR.isErr || nameR.isErr) {
      throw new Error(`Persisted product ${row.id} has invalid data`);
    }

    const barcode = row.barcode ? (Barcode.create(row.barcode).isOk ? Barcode.create(row.barcode).value : null) : null;
    const netWeight = row.netWeightGrams ? Weight.fromGrams(Number(row.netWeightGrams)).value : null;
    const grossWeight = row.grossWeightGrams ? Weight.fromGrams(Number(row.grossWeightGrams)).value : null;
    const storage =
      row.storageTempMinC !== null && row.storageTempMaxC !== null
        ? TemperatureRange.create(Number(row.storageTempMinC), Number(row.storageTempMaxC)).value
        : null;

    const components: BOMComponent[] = row.components.map((c) =>
      BOMComponent.reconstitute({
        id: BOMComponentId.fromString(c.id),
        componentProductId: ProductId.fromString(c.componentId),
        quantity: Quantity.create(Number(c.quantity)).value,
        uomId: UnitOfMeasureId.fromString(c.uomId),
        position: c.position,
        notes: c.notes,
      }),
    );

    return Product.reconstitute({
      id: ProductId.fromString(row.id),
      tenantId: row.tenantId,
      code: codeR.value,
      sku: skuR.value,
      barcode,
      name: nameR.value,
      description: row.description,
      type: row.type as ProductType,
      status: row.status as ProductStatus,
      categoryId: CategoryId.fromString(row.categoryId),
      unitOfSaleId: UnitOfMeasureId.fromString(row.unitOfSaleId),
      packSize: row.packSize,
      netWeight,
      grossWeight,
      expiryDays: row.expiryDays,
      storageTemperature: storage,
      taxRate: row.taxRate !== null ? Number(row.taxRate) : null,
      imageUrl: row.imageUrl,
      isControlled: row.isControlled,
      components,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}

export class ProductVersionMismatchError extends Error {
  constructor(public readonly productId: string, public readonly expected: number) {
    super(`Product ${productId} version mismatch (expected ${expected})`);
    this.name = 'ProductVersionMismatchError';
  }
}
