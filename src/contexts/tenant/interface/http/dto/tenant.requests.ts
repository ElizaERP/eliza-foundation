import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

import { TenantPlan, TenantStatus } from '../../../domain';

// =====================================================================
// CreateTenantRequest
// =====================================================================
export class CreateTenantRequest {
  @ApiProperty({
    description:
      'Identificador legible único. Lowercase, alfanumérico con guiones. ' +
      'Debe empezar con letra. Ej: "acme", "congelados-bcm".',
    example: 'congelados-bcm',
    minLength: 3,
    maxLength: 50,
  })
  @IsString()
  @Length(3, 50)
  @Matches(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
    message:
      'code must be lowercase alphanumeric with single hyphens, starting with a letter',
  })
  code!: string;

  @ApiProperty({
    description: 'Razón social o nombre comercial del tenant.',
    example: 'BCM Congelados S.A.S.',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({
    description: 'Plan de suscripción inicial. Por defecto "Basic".',
    enum: TenantPlan,
    example: TenantPlan.Basic,
  })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;
}

// =====================================================================
// SuspendTenantRequest
// =====================================================================
export class SuspendTenantRequest {
  @ApiProperty({
    description: 'Razón de la suspensión (auditada en TenantSuspended event).',
    example: 'Cuenta vencida — non-payment > 30 days',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @Length(5, 500)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Versión esperada del agregado para optimistic concurrency.',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

// =====================================================================
// ChangePlanRequest
// =====================================================================
export class ChangePlanRequest {
  @ApiProperty({
    description: 'Nuevo plan al que se migra el tenant.',
    enum: TenantPlan,
    example: TenantPlan.Professional,
  })
  @IsEnum(TenantPlan)
  newPlan!: TenantPlan;

  @ApiPropertyOptional({ description: 'Versión esperada del agregado.', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

// =====================================================================
// RenameTenantRequest
// =====================================================================
export class RenameTenantRequest {
  @ApiProperty({ description: 'Nuevo nombre.', example: 'Congelados BCM Nuevo S.A.S.' })
  @IsString()
  @MinLength(1)
  @Length(1, 200)
  newName!: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

// =====================================================================
// ActivateTenantRequest / DeleteTenantRequest (versión opcional)
// =====================================================================
export class VersionedActionRequest {
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

// =====================================================================
// ListTenantsQuery
// =====================================================================
export class ListTenantsQuery {
  @ApiPropertyOptional({
    description: 'Filtra por uno o más estados. Repetir el parámetro.',
    enum: TenantStatus,
    isArray: true,
  })
  @IsOptional()
  @IsEnum(TenantStatus, { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  status?: TenantStatus[];

  @ApiPropertyOptional({ description: 'Texto a buscar en code o name.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 1))
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Math.min(Number(value), 100) : 20))
  pageSize?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeDeleted?: boolean;
}

// =====================================================================
// Path params helper
// =====================================================================
export class TenantIdParam {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class TenantCodeParam {
  @ApiProperty({ example: 'congelados-bcm' })
  @IsString()
  @Length(3, 50)
  code!: string;
}
