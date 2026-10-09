import { Category } from '../../domain/category';
import { Product, ProductStatus, ProductType } from '../../domain/product';
import { UnitOfMeasure } from '../../domain/unit-of-measure';

export interface UnitOfMeasureView {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: string;
  toBaseFactor: number;
  isActive: boolean;
}

export interface CategoryView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parentId: string | null;
  path: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BOMComponentView {
  componentProductId: string;
  quantity: number;
  uomId: string;
  position: number;
  notes: string | null;
}

export interface ProductView {
  id: string;
  code: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  type: ProductType;
  status: ProductStatus;
  categoryId: string;
  unitOfSaleId: string;
  packSize: number | null;
  netWeightGrams: number | null;
  grossWeightGrams: number | null;
  expiryDays: number | null;
  storageTempMinC: number | null;
  storageTempMaxC: number | null;
  taxRate: number | null;
  salePrice: number | null;
  imageUrl: string | null;
  isControlled: boolean;
  components: BOMComponentView[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toProductView(p: Product): ProductView {
  return {
    id: p.id.value,
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
    netWeightGrams: p.netWeight?.grams ?? null,
    grossWeightGrams: p.grossWeight?.grams ?? null,
    expiryDays: p.expiryDays,
    storageTempMinC: p.storageTemperature?.minC ?? null,
    storageTempMaxC: p.storageTemperature?.maxC ?? null,
    taxRate: p.taxRate,
    salePrice: p.salePrice,
    imageUrl: p.imageUrl,
    isControlled: p.isControlled,
    components: p.components.map((c) => ({
      componentProductId: c.componentProductId.value,
      quantity: c.quantity.amount,
      uomId: c.uomId.value,
      position: c.position,
      notes: c.notes,
    })),
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toCategoryView(c: Category): CategoryView {
  return {
    id: c.id.value,
    code: c.code,
    name: c.name,
    description: c.description,
    parentId: c.parentId?.value ?? null,
    path: c.path,
    isActive: c.isActive,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toUomView(u: UnitOfMeasure): UnitOfMeasureView {
  return {
    id: u.id.value,
    code: u.code,
    name: u.name,
    symbol: u.symbol,
    dimension: u.dimension,
    toBaseFactor: u.toBaseFactor,
    isActive: u.isActive,
  };
}
