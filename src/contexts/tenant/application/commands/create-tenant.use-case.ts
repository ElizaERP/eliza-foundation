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
  Tenant,
  TenantCode,
  TenantErrors,
  TenantName,
  TenantPlan,
  TenantRepository,
} from '../../domain';

export interface CreateTenantInput {
  code: string;
  name: string;
  plan?: TenantPlan;
}

export interface CreateTenantOutput {
  id: string;
  code: string;
  name: string;
  status: string;
  plan: TenantPlan;
}

/**
 * CreateTenant — provisiona un nuevo tenant en la plataforma.
 *
 * Operación de PLATAFORMA: solo Platform Admin puede invocarla.
 * NO requiere tenant context establecido en el request, pero sí
 * userId del Platform Admin para audit trail (createdBy).
 *
 * Flujo:
 *   1. Validar inputs → construir VOs (TenantCode, TenantName)
 *   2. Verificar unicidad del code
 *   3. Crear el agregado (emite TenantCreated)
 *   4. Persistir vía repositorio (que también persiste el evento en outbox)
 */
@Injectable()
export class CreateTenant implements UseCase<CreateTenantInput, CreateTenantOutput> {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateTenantInput): Promise<Result<CreateTenantOutput, ApplicationError>> {
    // 1. VOs
    const codeResult = TenantCode.create(input.code);
    if (codeResult.isErr) {
      return err(applicationError(codeResult.error.code, codeResult.error.message, 'validation', codeResult.error.details));
    }
    const code = codeResult.value;

    const nameResult = TenantName.create(input.name);
    if (nameResult.isErr) {
      return err(applicationError(nameResult.error.code, nameResult.error.message, 'validation', nameResult.error.details));
    }
    const name = nameResult.value;

    // 2. Unicidad del code
    if (await this.tenants.existsByCode(code)) {
      const e = TenantErrors.codeAlreadyExists(code.value);
      return err(applicationError(e.code, e.message, 'conflict', e.details));
    }

    // 3. Crear agregado
    const createdBy = this.ctx.tryGetUserId() ?? 'system';
    const tenantResult = Tenant.create({
      code,
      name,
      plan: input.plan,
      createdBy,
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (tenantResult.isErr) {
      return err(applicationError(tenantResult.error.code, tenantResult.error.message, 'domain', tenantResult.error.details));
    }
    const tenant = tenantResult.value;

    // 4. Persistir
    await this.tenants.save(tenant);

    return ok({
      id: tenant.id.value,
      code: tenant.code.value,
      name: tenant.name.value,
      status: tenant.status,
      plan: tenant.plan,
    });
  }
}
