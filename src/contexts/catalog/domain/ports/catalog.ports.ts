import { Category } from '../category';
import { Product, ProductStatus, ProductType } from '../product';
import { UnitOfMeasure } from '../unit-of-measure';

// =====================================================================
// ProductRepository
// =====================================================================
export interface ProductRepository {
  save(product: Product, expectedVersion?: number): Promise<void>;
  findById(productId: string): Promise<Product | null>;
  findByCode(code: string): Promise<Product | null>;
  findBySku(sku: string): Promise<Product | null>;
  /** Para validar BOMs: que todos los componentProductId existan. */
  findByIds(productIds: string[]): Promise<Product[]>;
  query(filter: ProductQueryFilter): Promise<ProductQueryResult>;
  /** Búsqueda full-text en name/sku/code/barcode. */
  search(args: { tenantId: string; q: string; limit?: number }): Promise<Product[]>;
}

export interface ProductQueryFilter {
  tenantId: string;
  status?: ProductStatus[];
  type?: ProductType[];
  categoryId?: string;
  /** Soportar búsqueda en sub-árbol de categorías (path LIKE). */
  categoryPathPrefix?: string;
  isControlled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ProductQueryResult {
  items: Product[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const PRODUCT_REPOSITORY = Symbol('ProductRepository');

// =====================================================================
// CategoryRepository
// =====================================================================
export interface CategoryRepository {
  save(category: Category, expectedVersion?: number): Promise<void>;
  findById(categoryId: string): Promise<Category | null>;
  findByCode(code: string): Promise<Category | null>;
  findChildren(parentId: string | null): Promise<Category[]>;
  /** Para construir un árbol completo del tenant. */
  listAll(args: { tenantId: string; activeOnly?: boolean }): Promise<Category[]>;
}

export const CATEGORY_REPOSITORY = Symbol('CategoryRepository');

// =====================================================================
// UnitOfMeasureRepository
// =====================================================================
export interface UnitOfMeasureRepository {
  findById(uomId: string): Promise<UnitOfMeasure | null>;
  findByCode(code: string): Promise<UnitOfMeasure | null>;
  findByIds(uomIds: string[]): Promise<UnitOfMeasure[]>;
  listAll(args?: { dimension?: string; activeOnly?: boolean }): Promise<UnitOfMeasure[]>;
}

export const UNIT_OF_MEASURE_REPOSITORY = Symbol('UnitOfMeasureRepository');
