import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  CATEGORY_REPOSITORY,
  CategoryRepository,
  PRODUCT_REPOSITORY,
  Product,
  ProductRepository,
  ProductStatus,
  ProductType,
  UNIT_OF_MEASURE_REPOSITORY,
  UnitOfMeasureRepository,
} from '../../domain';
import { ProductView, toProductView } from '../dto/catalog.views';

// =====================================================================
// CreateProduct
// =====================================================================
export interface CreateProductInput {
  code: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  type: ProductType;
  categoryId: string;
  unitOfSaleId: string;
  packSize?: number;
  netWeightGrams?: number;
  grossWeightGrams?: number;
  expiryDays?: number;
  storageTempMinC?: number;
  storageTempMaxC?: number;
  taxRate?: number;
  imageUrl?: string;
  isControlled?: boolean;
}

@Injectable()
export class CreateProduct implements UseCase<CreateProductInput, ProductView> {
  private readonly logger = new Logger(CreateProduct.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly uoms: UnitOfMeasureRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateProductInput): Promise<Result<ProductView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('catalog.no_tenant', 'Tenant context required', 'unauthorized'));
    }

    // Verificar code y SKU únicos
    const existingCode = await this.products.findByCode(input.code);
    if (existingCode) {
      return err(applicationError('product.code_already_exists',
        `Product code '${input.code}' already exists`, 'conflict'));
    }
    const existingSku = await this.products.findBySku(input.sku);
    if (existingSku) {
      return err(applicationError('product.sku_already_exists',
        `Product SKU '${input.sku}' already exists`, 'conflict'));
    }

    // Verificar categoría existe + activa
    const category = await this.categories.findById(input.categoryId);
    if (!category) {
      return err(applicationError('category.not_found',
        `Category '${input.categoryId}' not found`, 'not_found'));
    }
    if (!category.isActive) {
      return err(applicationError('category.inactive',
        'Cannot create product in an inactive category', 'validation'));
    }

    // Verificar UoM existe
    const uom = await this.uoms.findById(input.unitOfSaleId);
    if (!uom) {
      return err(applicationError('uom.not_found',
        `Unit of measure '${input.unitOfSaleId}' not found`, 'not_found'));
    }

    const productR = Product.create({ ...input, tenantId, now: this.clock.now() });
    if (productR.isErr) {
      return err(applicationError(productR.error.code, productR.error.message, 'validation', productR.error.details));
    }

    await this.products.save(productR.value);
    this.logger.log(`Product created: ${input.code} (${input.sku}) [${productR.value.id.value}]`);
    return ok(toProductView(productR.value));
  }
}

// =====================================================================
// ActivateProduct / DiscontinueProduct
// =====================================================================
@Injectable()
export class ActivateProduct implements UseCase<{ productId: string; expectedVersion?: number }, ProductView> {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { productId: string; expectedVersion?: number }) {
    const product = await this.products.findById(input.productId);
    if (!product) {
      return err(applicationError('product.not_found', `Product '${input.productId}' not found`, 'not_found'));
    }
    const r = product.activate(this.clock.now());
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));
    await this.products.save(product, input.expectedVersion);
    return ok<ProductView, ApplicationError>(toProductView(product));
  }
}

@Injectable()
export class DiscontinueProduct
  implements UseCase<{ productId: string; reason: string; expectedVersion?: number }, ProductView>
{
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { productId: string; reason: string; expectedVersion?: number }) {
    const product = await this.products.findById(input.productId);
    if (!product) {
      return err(applicationError('product.not_found', `Product '${input.productId}' not found`, 'not_found'));
    }
    const r = product.discontinue(input.reason, this.clock.now());
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));
    await this.products.save(product, input.expectedVersion);
    return ok<ProductView, ApplicationError>(toProductView(product));
  }
}

// =====================================================================
// RenameProduct
// =====================================================================
@Injectable()
export class RenameProduct
  implements UseCase<{ productId: string; newName: string; expectedVersion?: number }, ProductView>
{
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { productId: string; newName: string; expectedVersion?: number }) {
    const product = await this.products.findById(input.productId);
    if (!product) return err(applicationError('product.not_found', `Product not found`, 'not_found'));
    const r = product.rename(input.newName, this.clock.now());
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));
    await this.products.save(product, input.expectedVersion);
    return ok<ProductView, ApplicationError>(toProductView(product));
  }
}

// =====================================================================
// SetBOM
// =====================================================================
export interface SetBOMInput {
  productId: string;
  components: Array<{
    componentProductId: string;
    quantity: number | string;
    uomId: string;
    position?: number;
    notes?: string;
  }>;
  expectedVersion?: number;
}

@Injectable()
export class SetBOM implements UseCase<SetBOMInput, ProductView> {
  private readonly logger = new Logger(SetBOM.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly uoms: UnitOfMeasureRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: SetBOMInput): Promise<Result<ProductView, ApplicationError>> {
    const product = await this.products.findById(input.productId);
    if (!product) {
      return err(applicationError('product.not_found', `Product '${input.productId}' not found`, 'not_found'));
    }

    // Validar que todos los componentes existen
    const componentIds = input.components.map((c) => c.componentProductId);
    const found = await this.products.findByIds(componentIds);
    const foundIds = new Set(found.map((p) => p.id.value));
    const missing = componentIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return err(applicationError('product.bom_components_not_found',
        `Component(s) not found: ${missing.join(', ')}`, 'not_found'));
    }

    // Validar que ningún componente es Service (no inventariable)
    const serviceComponents = found.filter((p) => p.type === ProductType.Service);
    if (serviceComponents.length > 0) {
      return err(applicationError('product.bom_service_component',
        `Services cannot be used as BOM components: ${serviceComponents.map((p) => p.code).join(', ')}`,
        'validation'));
    }

    // Validar que todas las UoMs existen
    const uomIds = Array.from(new Set(input.components.map((c) => c.uomId)));
    const uoms = await this.uoms.findByIds(uomIds);
    const foundUomIds = new Set(uoms.map((u) => u.id.value));
    const missingUoms = uomIds.filter((id) => !foundUomIds.has(id));
    if (missingUoms.length > 0) {
      return err(applicationError('uom.not_found',
        `UnitOfMeasure(s) not found: ${missingUoms.join(', ')}`, 'not_found'));
    }

    const r = product.setBOM({ components: input.components, now: this.clock.now() });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));

    await this.products.save(product, input.expectedVersion);
    this.logger.log(`BOM updated for ${product.code}: ${input.components.length} components`);
    return ok(toProductView(product));
  }
}

// =====================================================================
// Queries
// =====================================================================
@Injectable()
export class GetProductById implements UseCase<{ productId: string }, ProductView> {
  constructor(@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository) {}

  async execute(input: { productId: string }) {
    const p = await this.products.findById(input.productId);
    if (!p) return err(applicationError('product.not_found', `Product not found`, 'not_found'));
    return ok<ProductView, ApplicationError>(toProductView(p));
  }
}

@Injectable()
export class GetProductByCode implements UseCase<{ code: string }, ProductView> {
  constructor(@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository) {}

  async execute(input: { code: string }) {
    const p = await this.products.findByCode(input.code);
    if (!p) return err(applicationError('product.not_found', `Product with code '${input.code}' not found`, 'not_found'));
    return ok<ProductView, ApplicationError>(toProductView(p));
  }
}

export interface ListProductsInput {
  status?: ProductStatus[];
  type?: ProductType[];
  categoryId?: string;
  categoryPath?: string;
  isControlled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ListProductsOutput {
  items: ProductView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class ListProducts implements UseCase<ListProductsInput, ListProductsOutput> {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ListProductsInput) {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('catalog.no_tenant', 'Tenant context required', 'unauthorized'));
    }
    const result = await this.products.query({
      tenantId,
      status: input.status,
      type: input.type,
      categoryId: input.categoryId,
      categoryPathPrefix: input.categoryPath,
      isControlled: input.isControlled,
      page: input.page,
      pageSize: input.pageSize,
    });
    return ok<ListProductsOutput, ApplicationError>({
      items: result.items.map(toProductView),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  }
}

@Injectable()
export class SearchProducts implements UseCase<{ q: string; limit?: number }, ProductView[]> {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { q: string; limit?: number }) {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('catalog.no_tenant', 'Tenant context required', 'unauthorized'));
    }
    if (!input.q || input.q.trim().length < 2) {
      return ok<ProductView[], ApplicationError>([]);
    }
    const items = await this.products.search({ tenantId, q: input.q.trim(), limit: input.limit ?? 25 });
    return ok<ProductView[], ApplicationError>(items.map(toProductView));
  }
}
