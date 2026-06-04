import { Inject, Injectable } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
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
  TenantErrors,
  TenantId,
  TenantRepository,
} from '../../domain';

// =====================================================================
// ActivateTenant
// =====================================================================
export interface ActivateTenantInput {
  tenantId: string;
  expectedVersion?: number;
}

export interface ActivateTenantOutput {
  id: string;
  status: string;
  version: number;
}

@Injectable()
export class ActivateTenant
  implements UseCase<ActivateTenantInput, ActivateTenantOutput>
{
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ActivateTenantInput) {
    const tenant = await this.tenants.findById(TenantId.fromString(input.tenantId));
    if (!tenant) {
      const e = TenantErrors.notFound(input.tenantId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && tenant.version !== input.expectedVersion) {
      const e = TenantErrors.versionMismatch(input.expectedVersion, tenant.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const result = tenant.activate({
      activatedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });

    if (result.isErr) {
      return err(applicationError(result.error.code, result.error.message, 'domain', result.error.details));
    }

    await this.tenants.save(tenant);

    return ok<ActivateTenantOutput, ApplicationError>({
      id: tenant.id.value,
      status: tenant.status,
      version: tenant.version,
    });
  }
}

// =====================================================================
// SuspendTenant
// =====================================================================
export interface SuspendTenantInput {
  tenantId: string;
  reason: string;
  expectedVersion?: number;
}

export interface SuspendTenantOutput {
  id: string;
  status: string;
  version: number;
}

@Injectable()
export class SuspendTenant
  implements UseCase<SuspendTenantInput, SuspendTenantOutput>
{
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: SuspendTenantInput): Promise<Result<SuspendTenantOutput, ApplicationError>> {
    const tenant = await this.tenants.findById(TenantId.fromString(input.tenantId));
    if (!tenant) {
      const e = TenantErrors.notFound(input.tenantId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && tenant.version !== input.expectedVersion) {
      const e = TenantErrors.versionMismatch(input.expectedVersion, tenant.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const result = tenant.suspend({
      reason: input.reason,
      suspendedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });

    if (result.isErr) {
      return err(applicationError(result.error.code, result.error.message, 'domain', result.error.details));
    }

    await this.tenants.save(tenant);

    return ok({
      id: tenant.id.value,
      status: tenant.status,
      version: tenant.version,
    });
  }
}

// =====================================================================
// DeleteTenant
// =====================================================================
export interface DeleteTenantInput {
  tenantId: string;
  expectedVersion?: number;
}

export interface DeleteTenantOutput {
  id: string;
  status: string;
  version: number;
  deletedAt: string;
}

@Injectable()
export class DeleteTenant
  implements UseCase<DeleteTenantInput, DeleteTenantOutput>
{
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: DeleteTenantInput): Promise<Result<DeleteTenantOutput, ApplicationError>> {
    const tenant = await this.tenants.findById(TenantId.fromString(input.tenantId));
    if (!tenant) {
      const e = TenantErrors.notFound(input.tenantId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && tenant.version !== input.expectedVersion) {
      const e = TenantErrors.versionMismatch(input.expectedVersion, tenant.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const result = tenant.delete({
      deletedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });

    if (result.isErr) {
      return err(applicationError(result.error.code, result.error.message, 'domain', result.error.details));
    }

    await this.tenants.save(tenant);

    return ok({
      id: tenant.id.value,
      status: tenant.status,
      version: tenant.version,
      deletedAt: tenant.deletedAt!.toISOString(),
    });
  }
}
