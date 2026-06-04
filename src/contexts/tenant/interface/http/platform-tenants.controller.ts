import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  ActivateTenant,
  ChangePlan,
  CreateTenant,
  DeleteTenant,
  GetTenantById,
  GetTenantByCode,
  ListTenants,
  RenameTenant,
  SuspendTenant,
} from '../../application';
import {
  ChangePlanRequest,
  CreateTenantRequest,
  ListTenantsQuery,
  RenameTenantRequest,
  SuspendTenantRequest,
  TenantCodeParam,
  TenantIdParam,
  VersionedActionRequest,
} from './dto/tenant.requests';
import {
  ListTenantsResponse,
  TenantDeletedResponse,
  TenantPlanChangeResponse,
  TenantResponse,
  TenantStateChangeResponse,
} from './dto/tenant.responses';
import { toAppErrorOrThrow } from './result-utils';

/**
 * Endpoints de gestión de tenants para el Platform Admin.
 *
 *   POST   /platform/tenants                     → Crear tenant
 *   GET    /platform/tenants                     → Listar tenants
 *   GET    /platform/tenants/:id                 → Detalle por ID
 *   GET    /platform/tenants/by-code/:code       → Detalle por code (subdomain resolution)
 *   PATCH  /platform/tenants/:id                 → Renombrar
 *   POST   /platform/tenants/:id/activate        → Activar
 *   POST   /platform/tenants/:id/suspend         → Suspender
 *   POST   /platform/tenants/:id/change-plan     → Cambiar plan
 *   DELETE /platform/tenants/:id                 → Eliminar (soft)
 *
 * Requiere rol Platform.Admin (validado por AuthGuard del Sprint 2).
 */
@ApiTags('Platform · Tenants')
@ApiBearerAuth()
@RequireRoles('Platform.Admin')
@Controller({ path: 'platform/tenants', version: '1' })
export class PlatformTenantsController {
  constructor(
    private readonly createTenant: CreateTenant,
    private readonly activateTenant: ActivateTenant,
    private readonly suspendTenant: SuspendTenant,
    private readonly deleteTenant: DeleteTenant,
    private readonly changePlanUc: ChangePlan,
    private readonly renameTenantUc: RenameTenant,
    private readonly getTenantById: GetTenantById,
    private readonly getTenantByCode: GetTenantByCode,
    private readonly listTenantsUc: ListTenants,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Provisionar un nuevo tenant',
    description:
      'Crea el tenant en estado PendingActivation. Emite TenantCreated. ' +
      'El code debe ser único en toda la plataforma.',
  })
  @ApiOkResponse({ type: TenantResponse, status: 201 })
  async create(@Body() body: CreateTenantRequest): Promise<TenantResponse> {
    const result = await this.createTenant.execute({
      code: body.code,
      name: body.name,
      plan: body.plan,
    });
    return toAppErrorOrThrow(result) as TenantResponse;
  }

  @Get()
  @ApiOperation({ summary: 'Listar tenants con filtros y paginación' })
  @ApiOkResponse({ type: ListTenantsResponse })
  async list(@Query() query: ListTenantsQuery): Promise<ListTenantsResponse> {
    const result = await this.listTenantsUc.execute({
      status: query.status,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      includeDeleted: query.includeDeleted,
    });
    return toAppErrorOrThrow(result) as ListTenantsResponse;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un tenant por ID' })
  @ApiOkResponse({ type: TenantResponse })
  async findById(@Param() params: TenantIdParam): Promise<TenantResponse> {
    const result = await this.getTenantById.execute({ tenantId: params.id });
    return toAppErrorOrThrow(result) as TenantResponse;
  }

  @Get('by-code/:code')
  @ApiOperation({
    summary: 'Resolver tenant por su code (subdomain resolution)',
  })
  @ApiOkResponse({ type: TenantResponse })
  async findByCode(@Param() params: TenantCodeParam): Promise<TenantResponse> {
    const result = await this.getTenantByCode.execute({ code: params.code });
    return toAppErrorOrThrow(result) as TenantResponse;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renombrar tenant' })
  @ApiOkResponse({ type: TenantStateChangeResponse })
  async rename(
    @Param() params: TenantIdParam,
    @Body() body: RenameTenantRequest,
  ) {
    const result = await this.renameTenantUc.execute({
      tenantId: params.id,
      newName: body.newName,
      expectedVersion: body.expectedVersion,
    });
    return toAppErrorOrThrow(result);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar tenant (PendingActivation → Active o Suspended → Active)' })
  @ApiOkResponse({ type: TenantStateChangeResponse })
  async activate(
    @Param() params: TenantIdParam,
    @Body() body: VersionedActionRequest,
  ): Promise<TenantStateChangeResponse> {
    const result = await this.activateTenant.execute({
      tenantId: params.id,
      expectedVersion: body?.expectedVersion,
    });
    return toAppErrorOrThrow(result) as TenantStateChangeResponse;
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspender un tenant Active' })
  @ApiOkResponse({ type: TenantStateChangeResponse })
  async suspend(
    @Param() params: TenantIdParam,
    @Body() body: SuspendTenantRequest,
  ): Promise<TenantStateChangeResponse> {
    const result = await this.suspendTenant.execute({
      tenantId: params.id,
      reason: body.reason,
      expectedVersion: body.expectedVersion,
    });
    return toAppErrorOrThrow(result) as TenantStateChangeResponse;
  }

  @Post(':id/change-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar plan del tenant' })
  @ApiOkResponse({ type: TenantPlanChangeResponse })
  async changePlan(
    @Param() params: TenantIdParam,
    @Body() body: ChangePlanRequest,
  ): Promise<TenantPlanChangeResponse> {
    const result = await this.changePlanUc.execute({
      tenantId: params.id,
      newPlan: body.newPlan,
      expectedVersion: body.expectedVersion,
    });
    return toAppErrorOrThrow(result) as TenantPlanChangeResponse;
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar tenant (soft delete, terminal)',
    description: 'Marca el tenant como Deleted. Operación irreversible.',
  })
  @ApiOkResponse({ type: TenantDeletedResponse })
  async delete(
    @Param() params: TenantIdParam,
    @Body() body: VersionedActionRequest,
  ): Promise<TenantDeletedResponse> {
    const result = await this.deleteTenant.execute({
      tenantId: params.id,
      expectedVersion: body?.expectedVersion,
    });
    return toAppErrorOrThrow(result) as TenantDeletedResponse;
  }
}
