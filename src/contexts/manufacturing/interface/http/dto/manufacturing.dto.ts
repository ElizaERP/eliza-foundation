import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import {
  EstadoOrdenProduccion,
  PrioridadProduccion,
} from '@eliza/contexts/manufacturing/domain';

// =====================================================================
// CreateProductionOrder
// =====================================================================
export class CreateProductionOrderDto {
  @ApiProperty({ example: 'OP-ARP-MINI-2026-06-001' })
  @IsString() @Matches(/^OP-[A-Z0-9][A-Z0-9-]{1,46}$/)
  codigo!: string;

  @ApiProperty({ description: 'ID del producto terminado a producir', format: 'uuid' })
  @IsUUID()
  productoTerminadoId!: string;

  @ApiProperty({ description: 'Cantidad de unidades a producir', example: 500 })
  @IsNumber() @Min(0.000001)
  cantidadObjetivo!: number;

  @ApiPropertyOptional({ enum: PrioridadProduccion, default: PrioridadProduccion.Media })
  @IsOptional() @IsEnum(PrioridadProduccion)
  prioridad?: PrioridadProduccion;

  @ApiPropertyOptional({ example: '2026-06-20T06:00:00.000Z' })
  @IsOptional() @Type(() => Date) @IsDate()
  fechaProgramada?: Date;

  @ApiPropertyOptional({ example: 'Producción semanal de arepas mini' })
  @IsOptional() @IsString() @Length(0, 1000)
  notas?: string;
}

// =====================================================================
// RecordConsumption
// =====================================================================
export class RecordConsumptionDto {
  @ApiProperty({ description: 'ID del producto MP consumido', format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 'RM-QUESO-FRESCO' })
  @IsString() @Length(1, 50)
  productCode!: string;

  @ApiProperty({ description: 'ID del lote del que se consumió', format: 'uuid' })
  @IsUUID()
  loteId!: string;

  @ApiProperty({ example: 'BCM-RM-QUESO-2026-06-01-001' })
  @IsString() @Length(1, 50)
  codigoLote!: string;

  @ApiProperty({ example: 7.5 })
  @IsNumber() @Min(0.000001)
  cantidad!: number;

  @ApiProperty({ example: 'kg' })
  @IsString() @Length(1, 10)
  unidadMedida!: string;

  @ApiProperty({ description: 'ID del movimiento de inventario generado', format: 'uuid' })
  @IsString()
  movimientoId!: string;
}

// =====================================================================
// RecordProduction
// =====================================================================
export class RecordProductionDto {
  @ApiProperty({ example: 'BCM-ARP-MINI-2026-06-20-001' })
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{2,49}$/)
  codigoLote!: string;

  @ApiProperty({ description: 'Cantidad real producida', example: 480 })
  @IsNumber() @Min(0.000001)
  cantidad!: number;

  @ApiProperty({ description: 'Fecha de vencimiento del lote producido', example: '2026-12-20T00:00:00.000Z' })
  @Type(() => Date) @IsDate()
  fechaVencimiento!: Date;

  @ApiProperty({ description: 'Ubicación destino (ej: cámara de congelación)', format: 'uuid' })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({ example: 'Lote producido turno mañana' })
  @IsOptional() @IsString() @Length(0, 500)
  notas?: string;
}

// =====================================================================
// CancelProductionOrder
// =====================================================================
export class CancelProductionOrderDto {
  @ApiProperty({ example: 'Falta de materia prima — queso agotado' })
  @IsString() @Length(3, 500)
  motivo!: string;
}

// =====================================================================
// ListProductionOrders query
// =====================================================================
export class ListProductionOrdersQueryDto {
  @ApiPropertyOptional({ enum: EstadoOrdenProduccion })
  @IsOptional() @IsEnum(EstadoOrdenProduccion)
  estado?: EstadoOrdenProduccion;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  productoTerminadoId?: string;

  @ApiPropertyOptional({ enum: PrioridadProduccion })
  @IsOptional() @IsEnum(PrioridadProduccion)
  prioridad?: PrioridadProduccion;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number = 0;
}