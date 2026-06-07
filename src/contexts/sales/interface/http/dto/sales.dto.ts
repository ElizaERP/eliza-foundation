import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
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
  CondicionesPago,
  EstadoCliente,
  EstadoOrdenVenta,
} from '@eliza/contexts/sales/domain';

// =====================================================================
// DireccionDto (reutilizable)
// =====================================================================
export class DireccionDto {
  @ApiProperty({ example: 'Carrera 27 #36-65' })
  @IsString() @Length(5, 300)
  direccion!: string;

  @ApiProperty({ example: 'Bucaramanga' })
  @IsString() @Length(2, 100)
  ciudad!: string;

  @ApiProperty({ example: 'Santander' })
  @IsString() @Length(2, 100)
  departamento!: string;

  @ApiPropertyOptional({ example: '+57 316 123 4567' })
  @IsOptional() @IsString() @Length(0, 30)
  telefono?: string;

  @ApiPropertyOptional({ example: 'Preguntar por bodega trasera' })
  @IsOptional() @IsString() @Length(0, 500)
  notas?: string;
}

// =====================================================================
// Customer DTOs
// =====================================================================
export class CreateCustomerDto {
  @ApiProperty({ example: 'CLI-DIST-BGA-001' })
  @IsString() @Matches(/^CLI-[A-Z0-9][A-Z0-9-]{0,46}$/)
  codigo!: string;

  @ApiProperty({ example: '900123456-7', description: 'NIT colombiano' })
  @IsString() @Length(6, 15)
  nit!: string;

  @ApiProperty({ example: 'Distribuidora La Nevera S.A.S.' })
  @IsString() @Length(3, 200)
  razonSocial!: string;

  @ApiPropertyOptional({ example: 'La Nevera' })
  @IsOptional() @IsString() @Length(0, 200)
  nombreComercial?: string;

  @ApiPropertyOptional({ enum: CondicionesPago, default: CondicionesPago.Contado })
  @IsOptional() @IsEnum(CondicionesPago)
  condicionesPago?: CondicionesPago;

  @ApiProperty({ type: DireccionDto })
  @ValidateNested() @Type(() => DireccionDto) @IsObject()
  direccionFiscal!: DireccionDto;

  @ApiPropertyOptional({ type: DireccionDto })
  @IsOptional() @ValidateNested() @Type(() => DireccionDto) @IsObject()
  direccionEntrega?: DireccionDto;

  @ApiPropertyOptional({ example: 'María García' })
  @IsOptional() @IsString() @Length(0, 200)
  contactoNombre?: string;

  @ApiPropertyOptional({ example: '+57 316 123 4567' })
  @IsOptional() @IsString() @Length(0, 30)
  contactoTelefono?: string;

  @ApiPropertyOptional({ example: 'ventas@lanevera.com' })
  @IsOptional() @IsEmail()
  contactoEmail?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 1000)
  notas?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ example: 'Distribuidora La Nevera S.A.S.' })
  @IsOptional() @IsString() @Length(3, 200)
  razonSocial?: string;

  @ApiPropertyOptional({ example: 'La Nevera' })
  @IsOptional() @IsString() @Length(0, 200)
  nombreComercial?: string;

  @ApiPropertyOptional({ enum: CondicionesPago })
  @IsOptional() @IsEnum(CondicionesPago)
  condicionesPago?: CondicionesPago;

  @ApiPropertyOptional({ type: DireccionDto })
  @IsOptional() @ValidateNested() @Type(() => DireccionDto) @IsObject()
  direccionFiscal?: DireccionDto;

  @ApiPropertyOptional({ type: DireccionDto, nullable: true, description: 'Set to null to remove' })
  @IsOptional() @ValidateNested() @Type(() => DireccionDto)
  direccionEntrega?: DireccionDto | null;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 200)
  contactoNombre?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 30)
  contactoTelefono?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsEmail()
  contactoEmail?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 1000)
  notas?: string;
}

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ enum: EstadoCliente })
  @IsOptional() @IsEnum(EstadoCliente)
  estado?: EstadoCliente;

  @ApiPropertyOptional({ description: 'Search by razón social, NIT, nombre comercial or código' })
  @IsOptional() @IsString() @Length(0, 100)
  search?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number = 0;
}

// =====================================================================
// Sales Order DTOs
// =====================================================================
export class CreateSalesOrderDto {
  @ApiProperty({ example: 'PV-2026-06-001' })
  @IsString() @Matches(/^PV-[A-Z0-9][A-Z0-9-]{1,46}$/)
  codigo!: string;

  @ApiProperty({ description: 'ID del cliente', format: 'uuid' })
  @IsUUID()
  clienteId!: string;

  @ApiPropertyOptional({ enum: CondicionesPago, description: 'Override customer default' })
  @IsOptional() @IsEnum(CondicionesPago)
  condicionesPago?: CondicionesPago;

  @ApiPropertyOptional({ type: DireccionDto, description: 'Override customer delivery address' })
  @IsOptional() @ValidateNested() @Type(() => DireccionDto) @IsObject()
  direccionEntrega?: DireccionDto;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @Length(0, 1000)
  notas?: string;
}

export class AddOrderLineDto {
  @ApiProperty({ description: 'ID del producto', format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 50, description: 'Cantidad de unidades' })
  @IsNumber() @Min(0.000001)
  cantidad!: number;

  @ApiProperty({ example: 15000, description: 'Precio unitario en COP' })
  @IsNumber() @Min(0.01)
  precioUnitario!: number;

  @ApiPropertyOptional({ example: 'Entrega parcial OK' })
  @IsOptional() @IsString() @Length(0, 500)
  notas?: string;
}

export class CancelOrderDto {
  @ApiProperty({ example: 'Cliente solicitó cancelación por cambio de pedido' })
  @IsString() @Length(3, 500)
  motivo!: string;
}

export class ListSalesOrdersQueryDto {
  @ApiPropertyOptional({ enum: EstadoOrdenVenta })
  @IsOptional() @IsEnum(EstadoOrdenVenta)
  estado?: EstadoOrdenVenta;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  clienteId?: string;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Date) @IsDate()
  creadoDesde?: Date;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Date) @IsDate()
  creadoHasta?: Date;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number = 0;
}