import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
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
  OrigenLote,
  TipoMovimiento,
  TipoReferencia,
  TipoUbicacion,
} from '@eliza/contexts/inventory/domain';

// =====================================================================
// Lote DTOs
// =====================================================================
export class RegisterLotDto {
  @ApiProperty({ example: 'BCM-ARP-MINI-2026-06-15-001' })
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{2,49}$/)
  codigoLote!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() productId!: string;

  @ApiProperty({ example: '2026-06-15T00:00:00.000Z' })
  @Type(() => Date) @IsDate()
  fechaProduccion!: Date;

  @ApiProperty({ example: '2026-12-15T00:00:00.000Z' })
  @Type(() => Date) @IsDate()
  fechaVencimiento!: Date;

  @ApiProperty({ example: 500 })
  @IsNumber() @Min(0.000001)
  cantidadInicial!: number;

  @ApiProperty({ enum: OrigenLote, example: OrigenLote.Manual })
  @IsEnum(OrigenLote)
  origenTipo!: OrigenLote;

  @ApiPropertyOptional({ description: 'ID de la OC o OP de origen' })
  @IsOptional() @IsString()
  origenRef?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 1000)
  notas?: string;
}

export class BlockLotDto {
  @ApiProperty({ example: 'Defecto detectado en muestra' })
  @IsString() @Length(3, 500)
  reason!: string;
}

// =====================================================================
// Stock / Existencia DTOs
// =====================================================================
export class ReceiveInventoryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() productId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() loteId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() locationId!: string;

  @ApiProperty({ example: 500 })
  @IsNumber() @Min(0.000001)
  cantidad!: number;

  @ApiProperty({ enum: TipoReferencia })
  @IsEnum(TipoReferencia)
  referenciaTipo!: TipoReferencia;

  @ApiProperty({ example: 'manual-init-001' })
  @IsString() @Length(1, 100)
  referenciaId!: string;
}

export class ReserveStockDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() productId!: string;

  @ApiProperty({ example: 100 })
  @IsNumber() @Min(0.000001)
  cantidad!: number;

  @ApiProperty({ enum: TipoReferencia })
  @IsEnum(TipoReferencia)
  referenciaTipo!: TipoReferencia;

  @ApiProperty({ example: 'order-12345' })
  @IsString() @Length(1, 100)
  referenciaId!: string;

  @ApiPropertyOptional({ description: 'Limita la reserva a una ubicación' })
  @IsOptional() @IsUUID()
  locationId?: string;
}

export class ReleaseReservationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() productId!: string;

  @ApiProperty({ enum: TipoReferencia })
  @IsEnum(TipoReferencia)
  referenciaTipo!: TipoReferencia;

  @ApiProperty({ example: 'order-12345' })
  @IsString() referenciaId!: string;

  @ApiProperty({ example: 'Order cancelled by customer' })
  @IsString() @Length(3, 500)
  reason!: string;
}

export class AdjustStockDto {
  @ApiPropertyOptional({ description: 'Positive to add, negative to subtract. Send delta OR cantidadContada.', example: -2 })
  @IsOptional() @IsNumber()
  delta?: number;

  @ApiPropertyOptional({ description: 'Physical count at this location (available + reserved + blocked). The server computes the delta.', example: 48 })
  @IsOptional() @IsNumber() @Min(0)
  cantidadContada?: number;

  @ApiProperty({ example: 'Conteo cíclico Q2-2026' })
  @IsString() @Length(3, 500)
  motivo!: string;
}

/** Recibir mercancía (Sprint 13): crea el lote y lo ingresa en un solo paso. */
export class RegisterReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() productId!: string;

  @ApiProperty({ example: 'HAR-2026-10-09-01' })
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{2,49}$/)
  codigoLote!: string;

  @ApiProperty({ example: 250 })
  @IsNumber() @Min(0.000001)
  cantidad!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() locationId!: string;

  @ApiProperty({ example: '2027-04-09' })
  @Type(() => Date) @IsDate()
  fechaVencimiento!: Date;

  @ApiPropertyOptional({ description: 'Por defecto: ahora' })
  @IsOptional() @Type(() => Date) @IsDate()
  fechaProduccion?: Date;

  @ApiProperty({ enum: [OrigenLote.Purchase, OrigenLote.Manual], example: OrigenLote.Purchase })
  @IsIn([OrigenLote.Purchase, OrigenLote.Manual])
  origenTipo!: OrigenLote.Purchase | OrigenLote.Manual;

  @ApiProperty({ description: 'Factura/remisión del proveedor, o referencia de la entrada manual', example: 'FAC-10234' })
  @IsString() @Length(1, 100)
  documento!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 1000)
  notas?: string;
}

export class TransferStockDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() productId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() loteId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() origenLocationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID() destinoLocationId!: string;

  @ApiProperty({ example: 50 })
  @IsNumber() @Min(0.000001)
  cantidad!: number;
}

export class DispatchInventoryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() productId!: string;

  @ApiProperty({ enum: TipoReferencia })
  @IsEnum(TipoReferencia)
  referenciaTipo!: TipoReferencia;

  @ApiProperty({ example: 'order-12345' })
  @IsString() referenciaId!: string;
}

// =====================================================================
// Warehouse / Location DTOs
// =====================================================================
export class CreateWarehouseDto {
  @ApiProperty({ example: 'PB' })
  @IsString() @Matches(/^[A-Z][A-Z0-9-]{1,29}$/)
  code!: string;

  @ApiProperty({ example: 'Planta Bucaramanga' })
  @IsString() @Length(2, 200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 500)
  address?: string;
}

export class CreateLocationDto {
  @ApiProperty({ example: 'CAM-FZ-01' })
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{1,29}$/)
  code!: string;

  @ApiProperty({ example: 'Cámara de Congelación 01' })
  @IsString() @Length(2, 200)
  name!: string;

  @ApiProperty({ enum: TipoUbicacion })
  @IsEnum(TipoUbicacion)
  tipoUbicacion!: TipoUbicacion;

  @ApiPropertyOptional({ example: -20 })
  @IsOptional() @IsNumber() @Min(-50) @Max(50)
  tempMinC?: number;

  @ApiPropertyOptional({ example: -15 })
  @IsOptional() @IsNumber() @Min(-50) @Max(50)
  tempMaxC?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber() @Min(0)
  capacidadMax?: number;
}

// =====================================================================
// Movement query DTO
// =====================================================================
export class MovementHistoryQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  loteId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ enum: TipoMovimiento })
  @IsOptional() @IsEnum(TipoMovimiento)
  tipo?: TipoMovimiento;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Date) @IsDate()
  ocurridoDesde?: Date;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Date) @IsDate()
  ocurridoHasta?: Date;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  referenciaId?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number = 0;
}

export class ListExpiringQueryDto {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  withinDays?: number = 30;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number = 100;
}
