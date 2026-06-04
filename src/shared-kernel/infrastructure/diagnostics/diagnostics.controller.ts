import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';

import {
  CLOCK_PORT,
  ClockPort,
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '../../application/ports';
import { applicationError } from '../../application/use-case';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLS_CORRELATION_ID,
  CLS_REQUEST_IP,
  CLS_TENANT_ID,
  CLS_USER_AGENT,
  CLS_USER_ID,
  CLS_USER_ROLES,
} from '../tenant-context/tenant-context.service';

/**
 * Diagnostics — endpoints internos para validar manualmente la
 * infraestructura del Sprint 0. NO se exponen en producción.
 *
 *   GET /diagnostics/who-am-i              → eco del tenant context resuelto
 *   GET /diagnostics/rls-check             → valida que RLS está activo en Postgres
 *   GET /diagnostics/errors/:type          → dispara cada tipo de error
 *
 * El TenantContextMiddleware se aplica a estas rutas, así que se
 * pueden usar para verificar las tres estrategias de resolución
 * (JWT, header, subdomain).
 */
@ApiTags('Diagnostics')
@ApiBearerAuth()
@Controller({ path: 'diagnostics', version: '1' })
export class DiagnosticsController {
  constructor(
    @Inject(TENANT_CONTEXT_PORT) private readonly tenant: TenantContextPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    private readonly cls: ClsService,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------
  // GET /api/v1/diagnostics/who-am-i
  // -------------------------------------------------------------------
  @Get('who-am-i')
  @ApiOperation({
    summary: 'Eco del tenant context resuelto por el middleware',
    description:
      'Devuelve el tenantId, userId, roles, correlationId y metadata ' +
      'del request actual. Útil para verificar que el JWT / header / ' +
      'subdomain se está parseando correctamente.',
  })
  whoAmI() {
    return {
      tenantId: this.tenant.tryGetTenantId(),
      userId: this.tenant.tryGetUserId(),
      roles: this.cls.get<string[]>(CLS_USER_ROLES) ?? [],
      correlationId: this.tenant.getCorrelationId(),
      requestIp: this.cls.get<string>(CLS_REQUEST_IP),
      userAgent: this.cls.get<string>(CLS_USER_AGENT),
      serverTime: this.clock.nowIso(),
    };
  }

  // -------------------------------------------------------------------
  // GET /api/v1/diagnostics/rls-check
  // -------------------------------------------------------------------
  @Get('rls-check')
  @ApiOperation({
    summary: 'Valida que PostgreSQL RLS está activo',
    description:
      'Llama a platform.current_tenant_id() dentro de una transacción ' +
      'con SET LOCAL. Si el SET no se aplicó, la función lanza ' +
      'insufficient_privilege.',
  })
  async rlsCheck() {
    const tenantId = this.tenant.getTenantId();

    const result = await this.prisma.withTenant(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ tenant_id: string; user_id: string | null; correlation_id: string | null }>
      >`
        SELECT
          current_setting('app.tenant_id', false)::text       AS tenant_id,
          current_setting('app.user_id', true)::text          AS user_id,
          current_setting('app.correlation_id', true)::text   AS correlation_id
      `;
      return rows[0];
    });

    return {
      rls: 'active',
      sessionSettings: result,
      matchesContext: result.tenant_id === tenantId,
    };
  }

  // -------------------------------------------------------------------
  // GET /api/v1/diagnostics/errors/:type
  // -------------------------------------------------------------------
  @Get('errors/:type')
  @ApiOperation({
    summary: 'Dispara distintos tipos de error para validar Problem Details',
    description:
      'Tipos válidos: validation, not_found, conflict, unauthorized, ' +
      'forbidden, tenant_inactive, concurrency, infrastructure, ' +
      'domain, unhandled, http_404.',
  })
  triggerError(@Param('type') type: string): unknown {
    switch (type) {
      case 'validation':
        throw applicationError(
          'diagnostics.invalid_input',
          'The provided input did not pass validation',
          'validation',
          { field: 'sample', expected: 'uuid' },
        );

      case 'not_found':
        throw applicationError(
          'diagnostics.resource_missing',
          'The requested diagnostic resource was not found',
          'not_found',
        );

      case 'conflict':
        throw applicationError(
          'diagnostics.duplicate',
          'A resource with that key already exists',
          'conflict',
        );

      case 'unauthorized':
        throw applicationError(
          'diagnostics.no_credentials',
          'Authentication is required',
          'unauthorized',
        );

      case 'forbidden':
        throw applicationError(
          'diagnostics.role_required',
          'You do not have the role required for this action',
          'forbidden',
          { requiredRole: 'TenantAdmin' },
        );

      case 'tenant_inactive':
        throw applicationError(
          'diagnostics.tenant_suspended',
          'The tenant is suspended',
          'tenant_inactive',
        );

      case 'concurrency':
        throw applicationError(
          'diagnostics.version_mismatch',
          'The resource was modified by another request',
          'concurrency',
          { expectedVersion: 3, actualVersion: 5 },
        );

      case 'infrastructure':
        throw applicationError(
          'diagnostics.dependency_down',
          'A downstream dependency is not available',
          'infrastructure',
        );

      case 'domain':
        throw applicationError(
          'diagnostics.invariant_violated',
          'A domain invariant cannot be satisfied',
          'domain',
        );

      case 'unhandled':
        // Cualquier Error que el filtro convertirá a 500.
        throw new Error('Intentional unhandled error for diagnostics');

      case 'http_404':
        // NestJS HttpException — el filtro la traduce a Problem Details.
        throw new NotFoundException('Resource not found');

      case 'http_400':
        throw new BadRequestException(['field a is required', 'field b is invalid']);

      case 'http_401':
        throw new UnauthorizedException();

      case 'http_403':
        throw new ForbiddenException('Forbidden by policy');

      default:
        return {
          error: 'unknown_type',
          message: `Unknown error type: ${type}`,
          validTypes: [
            'validation', 'not_found', 'conflict', 'unauthorized',
            'forbidden', 'tenant_inactive', 'concurrency',
            'infrastructure', 'domain', 'unhandled',
            'http_404', 'http_400', 'http_401', 'http_403',
          ],
        };
    }
  }
}
