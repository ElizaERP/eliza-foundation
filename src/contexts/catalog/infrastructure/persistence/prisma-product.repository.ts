import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { newTimeOrderedUuid } from '@eliza/shared-kernel/domain';

import {
  BOMComponent,
  BOMComponentId,
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
} from '../../domain';

@Injectable()
export class PrismaProductRepository implements ProductRepository {
  private readonly logger = new Logger(PrismaProductRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async save(product: Product, expectedVersion?: number): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const isNew =
        product.version === 1 &&
        (await tx.product.count({ where: { id: product.id.value } })) === 0;

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

      const events = product.pullDomainEvents();
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

  async findById(productId: string): Promise<Product | null> {
    const row = await this.prisma.withTenant((tx) =>
      tx.product.findUnique({
        where: { id: productId },
        include: { components: { orderBy: { position: 'asc' } } },
      }),
    );
    return row ? this.toDomain(row) : null;
  }

  async findByCode(code: string): Promise<Product | null> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const row = await this.prisma.withTenant((tx) =>
      tx.product.findFirst({
        where: { tenantId, code },
        include: { components: { orderBy: { position: 'asc' } } },
      }),
    );
    return row ? this.toDomain(row) : null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const row = await this.prisma.withTenant((tx) =>
      tx.product.findFirst({
        where: { tenantId, sku },
        include: { components: { orderBy: { position: 'asc' } } },
      }),
    );
    return row ? this.toDomain(row) : null;
  }

  async findByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.withTenant((tx) =>
      tx.product.findMany({
        where: { id: { in: ids } },
        include: { components: { orderBy: { position: 'asc' } } },
      }),
    );
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

    const [rows, total] = await this.prisma.withTenant((tx) =>
      Promise.all([
        tx.product.findMany({
          where,
          include: { components: { orderBy: { position: 'asc' } } },
          orderBy: [{ status: 'asc' }, { code: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.product.count({ where }),
      ]),
    );

    return {
      items: rows.map((r) => this.toDomain(r)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async search(args: { tenantId: string; q: string; limit?: number }): Promise<Product[]> {
    const rows = await this.prisma.withTenant((tx) =>
      tx.product.findMany({
        where: {
          tenantId: args.tenantId,
          OR: [
            { name: { contains: args.q, mode: 'insensitive' } },
            { code: { contains: args.q, mode: 'insensitive' } },
            { sku: { contains: args.q, mode: 'insensitive' } },
            { barcode: { contains: args.q, mode: 'insensitive' } },
          ],
        },
        include: { components: { orderBy: { position: 'asc' } } },
        take: args.limit ?? 25,
      }),
    );
    return rows.map((r) => this.toDomain(r));
  }

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
      name: p.name,
      description: p.description,
      status: p.status,
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

  private toDomain(
    row: Prisma.ProductGetPayload<{ include: { components: true } }>,
  ): Product {
    const codeR = ProductCode.create(row.code);
    const skuR = Sku.create(row.sku);
    const nameR = EntityName.create(row.name, 'productName');
    if (codeR.isErr || skuR.isErr || nameR.isErr) {
      throw new Error(`Persisted product ${row.id} has invalid data`);
    }

    let barcode: Barcode | null = null;
    if (row.barcode) {
      const barR = Barcode.create(row.barcode);
      barcode = barR.isOk ? barR.value : null;
    }

    let netWeight: Weight | null = null;
    if (row.netWeightGrams) {
      const wR = Weight.fromGrams(Number(row.netWeightGrams));
      netWeight = wR.isOk ? wR.value : null;
    }

    let grossWeight: Weight | null = null;
    if (row.grossWeightGrams) {
      const wR = Weight.fromGrams(Number(row.grossWeightGrams));
      grossWeight = wR.isOk ? wR.value : null;
    }

    let storageTemperature: TemperatureRange | null = null;
    if (row.storageTempMinC !== null && row.storageTempMaxC !== null) {
      const tR = TemperatureRange.create(Number(row.storageTempMinC), Number(row.storageTempMaxC));
      storageTemperature = tR.isOk ? tR.value : null;
    }

    const components: BOMComponent[] = row.components.map((c) => {
      const qR = Quantity.create(Number(c.quantity));
      if (qR.isErr) throw new Error(`Invalid quantity in BOM component ${c.id}`);
      return BOMComponent.reconstitute({
        id: BOMComponentId.fromString(c.id),
        componentProductId: ProductId.fromString(c.componentId),
        quantity: qR.value,
        uomId: UnitOfMeasureId.fromString(c.uomId),
        position: c.position,
        notes: c.notes,
      });
    });

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
      storageTemperature,
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
  constructor(
    public readonly productId: string,
    public readonly expected: number,
  ) {
    super(`Product ${productId} version mismatch (expected ${expected})`);
    this.name = 'ProductVersionMismatchError';
  }
}
