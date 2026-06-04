import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

import { UserStatus } from '../../../domain';

// =====================================================================
// Requests
// =====================================================================

export class CreateUserRequest {
  @ApiProperty({ example: 'jane.doe@bcm-congelados.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @ApiProperty({ example: '7c9e6679-7425-40de-944b-e07fc1f90ae7', format: 'uuid' })
  @IsUUID('4')
  tenantId!: string;

  @ApiPropertyOptional({
    description: 'Roles iniciales a asignar dentro del tenant',
    example: ['Manufacturing.Operator'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  sendActivationEmail?: boolean;
}

export class SuspendUserRequest {
  @ApiProperty({ example: 'Account compromised' })
  @IsString()
  @Length(5, 500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

export class VersionedActionRequest {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

export class GrantMembershipRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  tenantId!: string;

  @ApiProperty({ isArray: true, example: ['Manufacturing.Operator'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roles!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

export class RoleChangeRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  tenantId!: string;

  @ApiProperty({ example: 'Sales.Manager' })
  @IsString()
  role!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  expectedVersion?: number;
}

export class UserIdParam {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string;
}

export class ListUsersQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Number(value) : 1))
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => (value !== undefined ? Math.min(Number(value), 100) : 20))
  pageSize?: number;
}

// =====================================================================
// Responses
// =====================================================================

export class MembershipResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  tenantId!: string;
  @ApiProperty({ isArray: true, example: ['Manufacturing.Operator'] })
  roles!: string[];
  @ApiProperty()
  isActive!: boolean;
  @ApiProperty({ format: 'date-time' })
  grantedAt!: string;
  @ApiProperty({ format: 'uuid' })
  grantedBy!: string;
  @ApiProperty({ format: 'date-time', nullable: true })
  revokedAt!: string | null;
}

export class UserResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty({ format: 'uuid' })
  keycloakSubject!: string;
  @ApiProperty()
  email!: string;
  @ApiProperty()
  fullName!: string;
  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;
  @ApiProperty({ type: [MembershipResponse] })
  memberships!: MembershipResponse[];
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ example: 1 })
  version!: number;
}

export class ListUsersResponse {
  @ApiProperty({ type: [UserResponse] })
  items!: UserResponse[];
  @ApiProperty({ example: 1 })
  page!: number;
  @ApiProperty({ example: 20 })
  pageSize!: number;
  @ApiProperty({ example: 47 })
  total!: number;
  @ApiProperty({ example: 3 })
  totalPages!: number;
}
