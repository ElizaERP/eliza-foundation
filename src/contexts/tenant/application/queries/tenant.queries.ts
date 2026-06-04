import { Inject, Injectable } from '@nestjs/common';

import {
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  TENANT_REPOSITORY,
  TenantCode,
  TenantErrors,
  TenantId,
  TenantRepository,
  TenantStatus,
} from '../../domain';
import { TenantView, toTenantView } from '../dto/tenant.view';

// =====================================================================
// GetTenantById — Platform Admin
// =====================================================================
@Injectable()
export class GetTenantById implements UseCase<{ tenantId: string }, TenantView> {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}

  async execute(input: { tenantId: string }): Promise<Result<TenantView, ApplicationError>> {
    const tenant = await this.tenants.findById(TenantId.fromString(input.tenantId));
    if (!tenant) {
      const e = TenantErrors.notFound(input.tenantId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }
    return ok(toTenantView(tenant));
  }
}

// =====================================================================
// GetTenantByCode — Platform Admin (resolución de subdomain → tenant_id)
// =====================================================================
@Injectable()
export class GetTenantByCode implements UseCase<{ code: string }, TenantView> {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}

  async execute(input: { code: string }): Promise<Result<TenantView, ApplicationError>> {
    const codeResult = TenantCode.create(input.code);
    if (codeResult.isErr) {
      return err(applicationError(codeResult.error.code, codeResult.error.message, 'validation', codeResult.error.details));
    }
    const tenant = await this.tenants.findByCode(codeResult.value);
    if (!tenant) {
      const e = TenantErrors.notFoundByCode(input.code);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }
    return ok(toTenantView(tenant));
  }
}

// =====================================================================
// GetMyTenant — el tenant del JWT del usuario actual
// Cualquier usuario autenticado puede consultar SU PROPIO tenant.
// =====================================================================
@Injectable()
export class GetMyTenant implements UseCase<void, TenantView> {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(): Promise<Result<TenantView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError(
        'tenant.no_context',
        'No tenant context resolved for this request',
        'unauthorized',
      ));
    }
    const tenant = await this.tenants.findById(TenantId.fromString(tenantId));
    if (!tenant) {
      const e = TenantErrors.notFound(tenantId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }
    return ok(toTenantView(tenant));
  }
}

// =====================================================================
// ListTenants — Platform Admin
// =====================================================================
export interface ListTenantsInput {
  status?: TenantStatus[];
  search?: string;
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
}

export interface ListTenantsOutput {
  items: TenantView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class ListTenants implements UseCase<ListTenantsInput, ListTenantsOutput> {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}

  async execute(input: ListTenantsInput): Promise<Result<ListTenantsOutput, ApplicationError>> {
    const page = input.page ?? 1;
    const pageSize = Math.min(input.pageSize ?? 20, 100);

    const result = await this.tenants.list({
      status: input.status,
      search: input.search,
      page,
      pageSize,
      includeDeleted: input.includeDeleted ?? false,
    });

    return ok({
      items: result.items.map(toTenantView),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  }
}
