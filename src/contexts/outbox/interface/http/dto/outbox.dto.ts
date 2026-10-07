import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { OutboxStatus } from '../../../domain';

export class QueryOutboxRequest {
  @ApiPropertyOptional({ isArray: true, enum: OutboxStatus })
  @IsOptional()
  @IsArray()
  @IsEnum(OutboxStatus, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  status?: OutboxStatus[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ example: 'tenant.TenantCreated.v1' })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({ example: 'Tenant' })
  @IsOptional()
  @IsString()
  aggregateType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  aggregateId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
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

export class EventIdParam {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;
}

export class OutboxEntryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  tenantId!: string;
  @ApiProperty()
  aggregateType!: string;
  @ApiProperty({ format: 'uuid' })
  aggregateId!: string;
  @ApiProperty({ example: 'tenant.TenantCreated.v1' })
  eventType!: string;
  @ApiProperty({ example: 1 })
  eventVersion!: number;
  @ApiProperty({ enum: OutboxStatus })
  status!: string;
  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true })
  nextRetryAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true })
  processingStartedAt!: string | null;
  @ApiProperty({ nullable: true })
  processingNode!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true })
  publishedAt!: string | null;
  @ApiProperty({ example: 0 })
  retryCount!: number;
  @ApiProperty({ nullable: true })
  lastError!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  payload!: Record<string, unknown>;
  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;
}

export class OutboxStatsResponse {
  @ApiProperty({ example: 12 }) pending!: number;
  @ApiProperty({ example: 0 }) processing!: number;
  @ApiProperty({ example: 4823 }) published!: number;
  @ApiProperty({ example: 1 }) failed!: number;
  @ApiProperty({ example: 0 }) deadLetter!: number;
  @ApiProperty({ example: 4836 }) total!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  counts!: Record<string, number>;
}

export class OutboxQueryResponse {
  @ApiProperty({ type: [OutboxEntryResponse] }) items!: OutboxEntryResponse[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class TenantSummaryResponse {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ example: 'bcm-congelados' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() plan!: string;
  @ApiProperty() userCount!: number;
  @ApiProperty() activeUserCount!: number;
  @ApiProperty({ format: 'date-time' }) lastEventAt!: string;
  @ApiProperty() lastEventType!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
