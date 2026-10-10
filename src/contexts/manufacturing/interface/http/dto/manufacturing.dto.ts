import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
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

// =====================================================================
// CompleteProductionOrder — consumo real (Sprint 15)
// =====================================================================
export class ConsumoRealDto {
  @ApiProperty({ format: 'uuid', description: 'Materia prima de la receta de la orden' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 5.8, description: 'Lo que se gastó de verdad (0 = no se usó)' })
  @IsNumber() @Min(0)
  cantidad!: number;
}

export class CompleteProductionOrderDto {
  @ApiPropertyOptional({
    type: [ConsumoRealDto],
    description: 'Consumo real por materia prima. Omitida = receta × cantidad realmente producida.',
  })
  @IsOptional() @IsArray() @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => ConsumoRealDto)
  consumos?: ConsumoRealDto[];
}

// =====================================================================
// Jornadas (Sprint 15)
// =====================================================================
export class JornadaLineaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productoTerminadoId!: string;

  @ApiProperty({ example: 500 })
  @IsNumber() @Min(0.000001)
  cantidadObjetivo!: number;
}

export class CreateJornadaDto {
  @ApiProperty({ type: [JornadaLineaDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => JornadaLineaDto)
  lineas!: JornadaLineaDto[];

  @ApiPropertyOptional({ enum: PrioridadProduccion })
  @IsOptional() @IsEnum(PrioridadProduccion)
  prioridad?: PrioridadProduccion;

  @ApiPropertyOptional({ example: '2026-10-11T11:00:00.000Z' })
  @IsOptional() @Type(() => Date) @IsDate()
  fechaProgramada?: Date;

  @ApiPropertyOptional({ example: 'Pedido grande de La quesita' })
  @IsOptional() @IsString() @Length(0, 1000)
  notas?: string;
}

export class ListJornadasQueryDto {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 30;
}
