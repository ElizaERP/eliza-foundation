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
  TenantName,
  TenantPlan,
  TenantRepository,
} from '../../domain';

// =====================================================================
// ChangePlan
// =====================================================================
export interface ChangePlanInput {
  tenantId: string;
  newPlan: TenantPlan;
  expectedVersion?: number;
}

export interface ChangePlanOutput {
  id: string;
  plan: TenantPlan;
  version: number;
}

@Injectable()
export class ChangePlan implements UseCase<ChangePlanInput, ChangePlanOutput> {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ChangePlanInput): Promise<Result<ChangePlanOutput, ApplicationError>> {
    const tenant = await this.tenants.findById(TenantId.fromString(input.tenantId));
    if (!tenant) {
      const e = TenantErrors.notFound(input.tenantId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && tenant.version !== input.expectedVersion) {
      const e = TenantErrors.versionMismatch(input.expectedVersion, tenant.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const result = tenant.changePlan({
      newPlan: input.newPlan,
      changedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });

    if (result.isErr) {
      const category = result.error.code === 'tenant.cannot_change_plan' ? 'forbidden'
        : result.error.code === 'tenant.same_plan' ? 'conflict'
        : 'domain';
      return err(applicationError(result.error.code, result.error.message, category, result.error.details));
    }

    await this.tenants.save(tenant);

    return ok({
      id: tenant.id.value,
      plan: tenant.plan,
      version: tenant.version,
    });
  }
}

// =====================================================================
// RenameTenant
// =====================================================================
export interface RenameTenantInput {
  tenantId: string;
  newName: string;
  expectedVersion?: number;
}

export interface RenameTenantOutput {
  id: string;
  name: string;
  version: number;
}

@Injectable()
export class RenameTenant implements UseCase<RenameTenantInput, RenameTenantOutput> {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: RenameTenantInput): Promise<Result<RenameTenantOutput, ApplicationError>> {
    const tenant = await this.tenants.findById(TenantId.fromString(input.tenantId));
    if (!tenant) {
      const e = TenantErrors.notFound(input.tenantId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && tenant.version !== input.expectedVersion) {
      const e = TenantErrors.versionMismatch(input.expectedVersion, tenant.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const nameResult = TenantName.create(input.newName);
    if (nameResult.isErr) {
      return err(applicationError(nameResult.error.code, nameResult.error.message, 'validation', nameResult.error.details));
    }

    const result = tenant.rename({
      newName: nameResult.value,
      renamedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
    });

    if (result.isErr) {
      return err(applicationError(result.error.code, result.error.message, 'domain', result.error.details));
    }

    await this.tenants.save(tenant);

    return ok({
      id: tenant.id.value,
      name: tenant.name.value,
      version: tenant.version,
    });
  }
}
