import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';

import {
  ActivateUser,
  AssignRole,
  CreateUser,
  DeleteUser,
  GetUserById,
  GrantMembership,
  ListUsersInTenant,
  RevokeMembership,
  RevokeRole,
  SuspendUser,
} from '../../application';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../infrastructure/auth/auth.guards';
import {
  CreateUserRequest,
  GrantMembershipRequest,
  ListUsersQuery,
  ListUsersResponse,
  RoleChangeRequest,
  SuspendUserRequest,
  UserIdParam,
  UserResponse,
  VersionedActionRequest,
} from './dto/user.dto';
import { toAppErrorOrThrow } from './result-utils';

/**
 * Endpoints accesibles solo a Platform.Admin.
 *  POST   /platform/users                  → crear usuario
 *  GET    /platform/users/:id              → consultar
 *  POST   /platform/users/:id/activate     → activar
 *  POST   /platform/users/:id/suspend      → suspender
 *  DELETE /platform/users/:id              → eliminar
 *  POST   /platform/users/:id/memberships  → grant
 *  POST   /platform/users/:id/roles        → assign role
 *  DELETE /platform/users/:id/memberships/:tenantId → revoke
 *  DELETE /platform/users/:id/roles        → revoke role
 */
@ApiTags('Platform · Users')
@ApiBearerAuth()
@RequireRoles('Platform.Admin')
@Controller({ path: 'platform/users', version: '1' })
export class PlatformUsersController {
  constructor(
    private readonly createUser: CreateUser,
    private readonly activate: ActivateUser,
    private readonly suspend: SuspendUser,
    private readonly del: DeleteUser,
    private readonly grant: GrantMembership,
    private readonly revoke: RevokeMembership,
    private readonly assignRole: AssignRole,
    private readonly revokeRole: RevokeRole,
    private readonly getById: GetUserById,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear usuario en cualquier tenant' })
  @ApiOkResponse({ type: UserResponse, status: 201 })
  async create(@Body() body: CreateUserRequest): Promise<UserResponse> {
    const result = await this.createUser.execute(body);
    return toAppErrorOrThrow(result) as UserResponse;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar usuario por ID' })
  @ApiOkResponse({ type: UserResponse })
  async findById(@Param() params: UserIdParam): Promise<UserResponse> {
    const result = await this.getById.execute({ userId: params.id });
    return toAppErrorOrThrow(result) as UserResponse;
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activateUser(@Param() params: UserIdParam, @Body() body: VersionedActionRequest) {
    const result = await this.activate.execute({
      userId: params.id,
      expectedVersion: body?.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspendUser(@Param() params: UserIdParam, @Body() body: SuspendUserRequest) {
    const result = await this.suspend.execute({
      userId: params.id,
      reason: body.reason,
      expectedVersion: body.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }

  @Delete(':id')
  async deleteUser(@Param() params: UserIdParam, @Body() body: VersionedActionRequest) {
    const result = await this.del.execute({
      userId: params.id,
      expectedVersion: body?.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }

  @Post(':id/memberships')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Otorgar membresía a un tenant' })
  async grantMembership(
    @Param() params: UserIdParam,
    @Body() body: GrantMembershipRequest,
  ) {
    const result = await this.grant.execute({
      userId: params.id,
      tenantId: body.tenantId,
      roles: body.roles,
      expectedVersion: body.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }

  @Delete(':id/memberships/:tenantId')
  @ApiOperation({ summary: 'Revocar membresía a un tenant' })
  async revokeMembership(
    @Param('id') id: string,
    @Param('tenantId') tenantId: string,
    @Body() body: VersionedActionRequest,
  ) {
    const result = await this.revoke.execute({
      userId: id,
      tenantId,
      expectedVersion: body?.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar un rol dentro de una membresía' })
  async assignRoleToMembership(
    @Param() params: UserIdParam,
    @Body() body: RoleChangeRequest,
  ) {
    const result = await this.assignRole.execute({
      userId: params.id,
      tenantId: body.tenantId,
      role: body.role,
      expectedVersion: body.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }

  @Delete(':id/roles')
  @ApiOperation({ summary: 'Revocar un rol dentro de una membresía' })
  async revokeRoleFromMembership(
    @Param() params: UserIdParam,
    @Body() body: RoleChangeRequest,
  ) {
    const result = await this.revokeRole.execute({
      userId: params.id,
      tenantId: body.tenantId,
      role: body.role,
      expectedVersion: body.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }
}

/**
 * Tenant Admin gestiona los usuarios de SU PROPIO tenant.
 *  POST   /tenants/me/users         → invitar usuario al tenant del JWT
 *  GET    /tenants/me/users         → listar usuarios del tenant del JWT
 */
@ApiTags('Tenant · Users')
@ApiBearerAuth()
@RequireRoles('Tenant.Admin', 'Platform.Admin')
@Controller({ path: 'tenants/me/users', version: '1' })
export class TenantUsersController {
  constructor(
    private readonly createUser: CreateUser,
    private readonly list: ListUsersInTenant,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invitar un usuario al tenant del JWT',
    description: 'Crea el usuario en Keycloak + ELIZA con membresía al tenant actual.',
  })
  @ApiOkResponse({ type: UserResponse, status: 201 })
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Omit<CreateUserRequest, 'tenantId'>,
  ): Promise<UserResponse> {
    if (!user.tenantId) {
      throw new Error('Authenticated user has no tenant context');
    }
    const result = await this.createUser.execute({
      ...body,
      tenantId: user.tenantId,
    });
    return toAppErrorOrThrow(result) as UserResponse;
  }

  @Get()
  @ApiOperation({ summary: 'Listar usuarios del tenant del JWT' })
  @ApiOkResponse({ type: ListUsersResponse })
  async listUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListUsersQuery,
  ): Promise<ListUsersResponse> {
    if (!user.tenantId) {
      throw new Error('Authenticated user has no tenant context');
    }
    const result = await this.list.execute({
      tenantId: user.tenantId,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
    return toAppErrorOrThrow(result) as ListUsersResponse;
  }
}
