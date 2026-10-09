import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { ProductStatus, ProductType } from '../../../domain/product';

// =====================================================================
// Product requests
// =====================================================================
export class CreateProductRequest {
  @ApiProperty({ example: 'ARP-MINI-12U' })
  @IsString() @Length(2, 50)
  code!: string;

  @ApiProperty({ example: 'ARP-MINI-12U' })
  @IsString() @Length(2, 50)
  sku!: string;

  @ApiPropertyOptional({ example: '7702345001234' })
  @IsOptional() @IsString()
  barcode?: string;

  @ApiProperty({ example: 'Arepa de Queso Mini x12 unidades' })
  @IsString() @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiProperty({ enum: ProductType, example: ProductType.FinishedGood })
  @IsEnum(ProductType)
  type!: ProductType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ format: 'uuid', description: 'UnitOfMeasure que usa esta unidad para venta' })
  @IsUUID()
  unitOfSaleId!: string;

  @ApiPropertyOptional({ example: 12, description: 'Número de unidades por paquete' })
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  packSize?: number;

  @ApiPropertyOptional({ example: 360, description: 'Peso neto en gramos' })
  @IsOptional() @IsNumber() @Min(0.001)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  netWeightGrams?: number;

  @ApiPropertyOptional({ example: 400 })
  @IsOptional() @IsNumber() @Min(0.001)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  grossWeightGrams?: number;

  @ApiPropertyOptional({ example: 90, description: 'Días de vida útil' })
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expiryDays?: number;

  @ApiPropertyOptional({ example: -18 })
  @IsOptional() @IsNumber()
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  storageTempMinC?: number;

  @ApiPropertyOptional({ example: -15 })
  @IsOptional() @IsNumber()
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  storageTempMaxC?: number;

  @ApiPropertyOptional({ example: 19, description: 'Porcentaje IVA' })
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  taxRate?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ example: true, description: 'Requiere cadena fría + control de lote' })
  @IsOptional() @IsBoolean()
  isControlled?: boolean;
}

export class DiscontinueProductRequest {
  @ApiProperty({ example: 'Producto descontinuado por proveedor' })
  @IsString() @Length(3, 500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

export class SetProductPriceRequest {
  @ApiProperty({ nullable: true, example: 4500, description: 'Precio de lista en COP, sin IVA. null lo quita.' })
  @ValidateIf((_o, v) => v !== null)
  @IsNumber() @Min(0.01)
  salePrice!: number | null;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

export class RenameProductRequest {
  @ApiProperty()
  @IsString() @Length(1, 200)
  newName!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

/**
 * Editar producto (Sprint 14). Campo omitido = no cambia; null = se borra.
 * Sin @Transform a propósito: convertiría null en 0.
 */
export class UpdateProductDetailsRequest {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsString() @Length(0, 2000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '7702345001234' })
  @IsOptional() @IsString() @Length(0, 14)
  barcode?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 12 })
  @IsOptional() @IsInt() @Min(1)
  packSize?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 360 })
  @IsOptional() @IsNumber() @Min(0.001)
  netWeightGrams?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 400 })
  @IsOptional() @IsNumber() @Min(0.001)
  grossWeightGrams?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 90 })
  @IsOptional() @IsInt() @Min(1)
  expiryDays?: number | null;

  @ApiPropertyOptional({ nullable: true, example: -18 })
  @IsOptional() @IsNumber()
  storageTempMinC?: number | null;

  @ApiPropertyOptional({ nullable: true, example: -15 })
  @IsOptional() @IsNumber()
  storageTempMaxC?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 19 })
  @IsOptional() @IsNumber() @Min(0) @Max(100)
  taxRate?: number | null;

  @ApiPropertyOptional({ description: 'Versión que tenía el producto al abrirlo (concurrencia optimista)' })
  @IsOptional() @IsInt() @Min(1)
  expectedVersion?: number;
}

export class VersionedAction {
  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

// ---------- BOM ----------
export class BOMComponentInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  componentProductId!: string;

  @ApiProperty({ example: 0.025, description: 'Cantidad por unidad del producto' })
  @IsNumber() @Min(0.000001)
  quantity!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  uomId!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsInt() @Min(0)
  position?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;
}

export class SetBOMRequest {
  @ApiProperty({ type: [BOMComponentInput] })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => BOMComponentInput)
  components!: BOMComponentInput[];

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  expectedVersion?: number;
}

// ---------- Listing ----------
export class ListProductsQuery {
  @ApiPropertyOptional({ isArray: true, enum: ProductStatus })
  @IsOptional() @IsArray() @IsEnum(ProductStatus, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  status?: ProductStatus[];

  @ApiPropertyOptional({ isArray: true, enum: ProductType })
  @IsOptional() @IsArray() @IsEnum(ProductType, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  type?: ProductType[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: '/congelados/arepas' })
  @IsOptional() @IsString()
  categoryPath?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isControlled?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 1))
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Math.min(Number(value), 100) : 25))
  pageSize?: number;
}

export class SearchProductsQuery {
  @ApiProperty({ example: 'arepa' })
  @IsString() @Length(2, 100)
  q!: string;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => (value !== undefined ? Math.min(Number(value), 100) : 25))
  limit?: number;
}

// =====================================================================
// Category requests
// =====================================================================
export class CreateCategoryRequest {
  @ApiProperty({ example: 'arepas' })
  @IsString() @Length(2, 50)
  code!: string;

  @ApiProperty({ example: 'Arepas' })
  @IsString() @Length(1, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  parentId?: string;
}

export class RenameCategoryRequest {
  @ApiProperty()
  @IsString() @Length(1, 200)
  newName!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  expectedVersion?: number;
}

export class DeactivateCategoryRequest {
  @ApiProperty()
  @IsString() @Length(3, 500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1)
  expectedVersion?: number;
}

// =====================================================================
// Responses
// =====================================================================
export class BOMComponentResponse {
  @ApiProperty({ format: 'uuid' }) componentProductId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ format: 'uuid' }) uomId!: string;
  @ApiProperty() position!: number;
  @ApiProperty({ nullable: true }) notes!: string | null;
}

export class ProductResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ nullable: true }) barcode!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ enum: ProductType }) type!: ProductType;
  @ApiProperty({ enum: ProductStatus }) status!: ProductStatus;
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty({ format: 'uuid' }) unitOfSaleId!: string;
  @ApiProperty({ nullable: true }) packSize!: number | null;
  @ApiProperty({ nullable: true }) netWeightGrams!: number | null;
  @ApiProperty({ nullable: true }) grossWeightGrams!: number | null;
  @ApiProperty({ nullable: true }) expiryDays!: number | null;
  @ApiProperty({ nullable: true }) storageTempMinC!: number | null;
  @ApiProperty({ nullable: true }) storageTempMaxC!: number | null;
  @ApiProperty({ nullable: true }) taxRate!: number | null;
  @ApiProperty({ nullable: true, description: 'Precio de lista en COP, sin IVA' }) salePrice!: number | null;
  @ApiProperty({ nullable: true }) imageUrl!: string | null;
  @ApiProperty() isControlled!: boolean;
  @ApiProperty({ type: [BOMComponentResponse] }) components!: BOMComponentResponse[];
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ListProductsResponse {
  @ApiProperty({ type: [ProductResponse] }) items!: ProductResponse[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class CategoryResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) parentId!: string | null;
  @ApiProperty() path!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CategoryTreeResponse extends CategoryResponse {
  @ApiProperty({ type: [CategoryTreeResponse] })
  children!: CategoryTreeResponse[];
}

export class UnitOfMeasureResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'kg' }) code!: string;
  @ApiProperty({ example: 'Kilogramo' }) name!: string;
  @ApiProperty({ example: 'kg' }) symbol!: string;
  @ApiProperty({ example: 'Mass' }) dimension!: string;
  @ApiProperty({ example: 1000 }) toBaseFactor!: number;
  @ApiProperty() isActive!: boolean;
}
