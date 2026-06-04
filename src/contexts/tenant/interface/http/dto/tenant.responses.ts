import { ApiProperty } from '@nestjs/swagger';

import { TenantPlan, TenantStatus } from '../../../domain';

export class TenantResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'congelados-bcm' })
  code!: string;

  @ApiProperty({ example: 'BCM Congelados S.A.S.' })
  name!: string;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty({ enum: TenantPlan })
  plan!: TenantPlan;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'uuid' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ format: 'uuid' })
  updatedBy!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  deletedAt!: string | null;

  @ApiProperty({ example: 1, description: 'Optimistic concurrency token' })
  version!: number;
}

export class TenantStateChangeResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty({ example: 2 })
  version!: number;
}

export class TenantPlanChangeResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TenantPlan })
  plan!: TenantPlan;

  @ApiProperty({ example: 2 })
  version!: number;
}

export class TenantDeletedResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty({ example: 2 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  deletedAt!: string;
}

export class ListTenantsResponse {
  @ApiProperty({ type: [TenantResponse] })
  items!: TenantResponse[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 47 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}
