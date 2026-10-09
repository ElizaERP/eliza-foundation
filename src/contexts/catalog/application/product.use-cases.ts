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
} from '@eliza/contexts/catalog/domain';
import { ProductView, toProductView } from '@eliza/contexts/catalog/application/dto/catalog.views';

/**
 * Guarda el producto traduciendo el conflicto de versión (otro usuario lo cambió
 * entre que se abrió y se guardó, o expectedVersion viejo) a un error 412 con
 * mensaje claro, en vez de un 500. Se compara por nombre para no importar la
 * clase de infraestructura en la capa de aplicación.
 */
async function guardar(
  products: ProductRepository, product: Product, expectedVersion?: number,
): Promise<Result<void, ApplicationError>> {
  try {
    await products.save(product, expectedVersion);
    return ok(undefined);
  } catch (e) {
    if (e instanceof Error && e.name === 'ProductVersionMismatchError') {
      return err(applicationError('product.version_conflict',
        'Alguien más modificó este producto mientras lo editabas. Vuelve a abrirlo e inténtalo de nuevo.',
        'concurrency'));
    }
    throw e;
  }
}

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
        `Ya existe un producto con el código ${input.code}.`, 'conflict'));
    }
    const existingSku = await this.products.findBySku(input.sku);
    if (existingSku) {
      return err(applicationError('product.sku_already_exists',
        `Ya existe un producto con el SKU ${input.sku}.`, 'conflict'));
    }

    // Verificar categoría existe + activa
    const category = await this.categories.findById(input.categoryId);
    if (!category) {
      return err(applicationError('category.not_found', 'La categoría no existe.', 'not_found'));
    }
    if (!category.isActive) {
      return err(applicationError('category.inactive', 'La categoría está inactiva.', 'validation'));
    }

    // Verificar UoM existe
    const uom = await this.uoms.findById(input.unitOfSaleId);
    if (!uom) {
      return err(applicationError('uom.not_found', 'La unidad de medida no existe.', 'not_found'));
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
    const g = await guardar(this.products, product, input.expectedVersion);
    if (g.isErr) return err(g.error);
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
    const g = await guardar(this.products, product, input.expectedVersion);
    if (g.isErr) return err(g.error);
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
    const antes = product.version;
    const r = product.rename(input.newName, this.clock.now());
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));
    // Mismo nombre: el dominio no cambia nada ni sube la versión; no hay que guardar
    // (guardar exigiría version - 1 y fallaría con ProductVersionMismatchError → 500).
    if (product.version !== antes) {
      const g = await guardar(this.products, product, input.expectedVersion);
      if (g.isErr) return err(g.error);
    }
    return ok<ProductView, ApplicationError>(toProductView(product));
  }
}

// =====================================================================
// SetProductPrice — precio de lista (COP, sin IVA)
// =====================================================================
@Injectable()
export class SetProductPrice
  implements UseCase<{ productId: string; salePrice: number | null; expectedVersion?: number }, ProductView>
{
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { productId: string; salePrice: number | null; expectedVersion?: number }) {
    const product = await this.products.findById(input.productId);
    if (!product) return err(applicationError('product.not_found', `Product not found`, 'not_found'));
    const antes = product.version;
    const r = product.setSalePrice(input.salePrice, this.clock.now());
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));
    // Mismo precio: operación idempotente, no se guarda (ver RenameProduct).
    if (product.version !== antes) {
      const g = await guardar(this.products, product, input.expectedVersion);
      if (g.isErr) return err(g.error);
    }
    return ok<ProductView, ApplicationError>(toProductView(product));
  }
}

// =====================================================================
// UpdateProductDetails (Sprint 14)
// =====================================================================
export interface UpdateProductDetailsInput {
  productId: string;
  name?: string;
  description?: string | null;
  barcode?: string | null;
  packSize?: number | null;
  netWeightGrams?: number | null;
  grossWeightGrams?: number | null;
  expiryDays?: number | null;
  storageTempMinC?: number | null;
  storageTempMaxC?: number | null;
  taxRate?: number | null;
  expectedVersion?: number;
}

/** Editar nombre y datos del producto en una sola operación (una sola versión). */
@Injectable()
export class UpdateProductDetails implements UseCase<UpdateProductDetailsInput, ProductView> {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: UpdateProductDetailsInput): Promise<Result<ProductView, ApplicationError>> {
    const product = await this.products.findById(input.productId);
    if (!product) return err(applicationError('product.not_found', 'El producto no existe.', 'not_found'));
    const { productId: _id, expectedVersion, ...cambios } = input;
    const antes = product.version;
    const r = product.updateDetails({ ...cambios, now: this.clock.now() });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'validation', r.error.details));
    if (product.version !== antes) {
      const g = await guardar(this.products, product, expectedVersion);
      if (g.isErr) return err(g.error);
    }
    return ok(toProductView(product));
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

    // Un componente descontinuado no se puede comprar ni producir (Sprint 14)
    const descontinuados = found.filter((p) => p.status === ProductStatus.Discontinued);
    if (descontinuados.length > 0) {
      return err(applicationError('product.bom_discontinued_component',
        `No se pueden usar productos descontinuados en la receta: ${descontinuados.map((p) => p.name).join(', ')}`,
        'validation'));
    }

    // Ciclos: si algún componente (o sus componentes, a cualquier nivel) usa
    // este producto, producirlo exigiría producirse a sí mismo (Sprint 14).
    const ciclo = await this.buscarCiclo(product.id.value, found);
    if (ciclo) {
      return err(applicationError('product.bom_cycle',
        `${ciclo} ya usa este producto en su receta: no puede ser componente suyo.`, 'validation'));
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

    const g = await guardar(this.products, product, input.expectedVersion);
    if (g.isErr) return err(g.error);
    this.logger.log(`BOM updated for ${product.code}: ${input.components.length} components`);
    return ok(toProductView(product));
  }

  /** Recorre las recetas de los componentes; devuelve el nombre del componente directo que lleva al ciclo. */
  private async buscarCiclo(productId: string, directos: Product[]): Promise<string | null> {
    for (const directo of directos) {
      const vistos = new Set<string>();
      let frontera: Product[] = [directo];
      for (let nivel = 0; nivel < 20 && frontera.length > 0; nivel++) {
        const ids: string[] = [];
        for (const p of frontera) {
          for (const c of p.components) {
            const cid = c.componentProductId.value;
            if (cid === productId) return directo.name;
            if (!vistos.has(cid)) { vistos.add(cid); ids.push(cid); }
          }
        }
        frontera = ids.length > 0 ? await this.products.findByIds(ids) : [];
      }
    }
    return null;
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
