import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class QueryAuditRequest {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ isArray: true, example: ['Create', 'Update'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  action?: string[];

  @ApiPropertyOptional({ example: 'Tenant' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  entityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiPropertyOptional({ format: 'date-time', example: '2026-06-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', example: '2026-06-30T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 1))
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Math.min(Number(value), 200) : 50))
  pageSize?: number;
}

export class EntityHistoryParam {
  @ApiProperty({ example: 'Tenant' })
  @IsString()
  entityType!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  entityId!: string;
}

export class VerifyChainQuery {
  @ApiPropertyOptional({ description: 'BigInt como string', example: '0' })
  @IsOptional()
  @IsString()
  fromChainIndex?: string;

  @ApiPropertyOptional({ description: 'BigInt como string', example: '1000' })
  @IsOptional()
  @IsString()
  toChainIndex?: string;
}

export class AuditEntryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  tenantId!: string;
  @ApiProperty({ example: '42', description: 'BigInt como string' })
  chainIndex!: string;
  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
  @ApiProperty({ format: 'uuid', nullable: true })
  userId!: string | null;
  @ApiProperty({ nullable: true })
  ipAddress!: string | null;
  @ApiProperty({ nullable: true })
  userAgent!: string | null;
  @ApiProperty({ example: 'Create' })
  action!: string;
  @ApiProperty({ example: 'Tenant' })
  entityType!: string;
  @ApiProperty({ format: 'uuid', nullable: true })
  entityId!: string | null;
  @ApiProperty({ nullable: true })
  oldValues!: unknown;
  @ApiProperty({ nullable: true })
  newValues!: unknown;
  @ApiProperty({ format: 'uuid', nullable: true })
  correlationId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  causationId!: string | null;
  @ApiProperty({ nullable: true, description: 'Hash de la entrada previa en la cadena' })
  previousHash!: string | null;
  @ApiProperty({ description: 'SHA-256 hex' })
  hash!: string;
}

export class AuditQueryResponse {
  @ApiProperty({ type: [AuditEntryResponse] })
  items!: AuditEntryResponse[];
  @ApiProperty()
  page!: number;
  @ApiProperty()
  pageSize!: number;
  @ApiProperty()
  total!: number;
  @ApiProperty()
  totalPages!: number;
}

export class VerifyChainResponse {
  @ApiProperty({ format: 'uuid' })
  tenantId!: string;
  @ApiProperty()
  entriesChecked!: number;
  @ApiProperty()
  isValid!: boolean;
  @ApiProperty({ nullable: true, description: 'BigInt como string' })
  firstBrokenChainIndex!: string | null;
  @ApiProperty({ nullable: true, enum: ['hash_mismatch', 'broken_link'] })
  brokenReason!: string | null;
}
