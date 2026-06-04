import { Inject, Injectable, Logger } from '@nestjs/common';

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
  IDENTITY_PROVIDER_PORT,
  IdentityProviderPort,
  USER_REPOSITORY,
  UserErrors,
  UserId,
  UserRepository,
} from '../../domain';

// =====================================================================
// ActivateUser
// =====================================================================
export interface ActivateUserInput {
  userId: string;
  expectedVersion?: number;
}

@Injectable()
export class ActivateUser implements UseCase<ActivateUserInput, { id: string; status: string; version: number }> {
  private readonly logger = new Logger(ActivateUser.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_PROVIDER_PORT) private readonly idp: IdentityProviderPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ActivateUserInput) {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && user.version !== input.expectedVersion) {
      const e = UserErrors.versionMismatch(input.expectedVersion, user.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const r = user.activate({
      activatedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain', r.error.details));

    await this.users.save(user);

    // Best-effort: habilitar en Keycloak. Si falla, el usuario está
    // Active en ELIZA pero deshabilitado en KC → no podrá entrar y un
    // operador deberá habilitarlo manualmente.
    try {
      await this.idp.setUserEnabled(user.keycloakSubject.value, true);
    } catch (e) {
      this.logger.warn(`Could not enable user in Keycloak: ${(e as Error).message}`);
    }

    return ok<{ id: string; status: string; version: number }, ApplicationError>({
      id: user.id.value,
      status: user.status,
      version: user.version,
    });
  }
}

// =====================================================================
// SuspendUser
// =====================================================================
export interface SuspendUserInput {
  userId: string;
  reason: string;
  expectedVersion?: number;
}

@Injectable()
export class SuspendUser implements UseCase<SuspendUserInput, { id: string; status: string; version: number }> {
  private readonly logger = new Logger(SuspendUser.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_PROVIDER_PORT) private readonly idp: IdentityProviderPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: SuspendUserInput) {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && user.version !== input.expectedVersion) {
      const e = UserErrors.versionMismatch(input.expectedVersion, user.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const r = user.suspend({
      reason: input.reason,
      suspendedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain', r.error.details));

    await this.users.save(user);

    try {
      await this.idp.setUserEnabled(user.keycloakSubject.value, false);
    } catch (e) {
      this.logger.warn(`Could not disable user in Keycloak: ${(e as Error).message}`);
    }

    return ok<{ id: string; status: string; version: number }, ApplicationError>({
      id: user.id.value,
      status: user.status,
      version: user.version,
    });
  }
}

// =====================================================================
// DeleteUser
// =====================================================================
@Injectable()
export class DeleteUser implements UseCase<{ userId: string; expectedVersion?: number }, { id: string; status: string }> {
  private readonly logger = new Logger(DeleteUser.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_PROVIDER_PORT) private readonly idp: IdentityProviderPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { userId: string; expectedVersion?: number }) {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && user.version !== input.expectedVersion) {
      const e = UserErrors.versionMismatch(input.expectedVersion, user.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const r = user.delete({
      deletedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain', r.error.details));

    await this.users.save(user);

    try {
      await this.idp.setUserEnabled(user.keycloakSubject.value, false);
    } catch (e) {
      this.logger.warn(`Could not disable user in Keycloak: ${(e as Error).message}`);
    }

    return ok<{ id: string; status: string }, ApplicationError>({
      id: user.id.value,
      status: user.status,
    });
  }
}

// =====================================================================
// GrantMembership / RevokeMembership / AssignRole / RevokeRole
// =====================================================================
@Injectable()
export class GrantMembership implements UseCase<{
  userId: string;
  tenantId: string;
  roles: string[];
  expectedVersion?: number;
}, { userId: string; tenantId: string; version: number }> {
  private readonly logger = new Logger(GrantMembership.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_PROVIDER_PORT) private readonly idp: IdentityProviderPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { userId: string; tenantId: string; roles: string[]; expectedVersion?: number }) {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && user.version !== input.expectedVersion) {
      const e = UserErrors.versionMismatch(input.expectedVersion, user.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const r = user.grantMembership({
      tenantId: input.tenantId,
      roles: input.roles,
      grantedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (r.isErr) {
      const category = r.error.code === 'iam.membership_already_exists' ? 'conflict' : 'domain';
      return err(applicationError(r.error.code, r.error.message, category, r.error.details));
    }

    await this.users.save(user);

    for (const role of input.roles) {
      try {
        await this.idp.assignClientRole(user.keycloakSubject.value, role);
      } catch (e) {
        this.logger.warn(`Failed to assign ${role} in Keycloak: ${(e as Error).message}`);
      }
    }

    return ok<{ userId: string; tenantId: string; version: number }, ApplicationError>({
      userId: user.id.value,
      tenantId: input.tenantId,
      version: user.version,
    });
  }
}

@Injectable()
export class RevokeMembership implements UseCase<{
  userId: string;
  tenantId: string;
  expectedVersion?: number;
}, { userId: string; tenantId: string; version: number }> {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { userId: string; tenantId: string; expectedVersion?: number }) {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && user.version !== input.expectedVersion) {
      const e = UserErrors.versionMismatch(input.expectedVersion, user.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const r = user.revokeMembership({
      tenantId: input.tenantId,
      revokedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (r.isErr) {
      const category = r.error.code === 'iam.membership_not_found' ? 'not_found' : 'domain';
      return err(applicationError(r.error.code, r.error.message, category, r.error.details));
    }

    await this.users.save(user);

    return ok<{ userId: string; tenantId: string; version: number }, ApplicationError>({
      userId: user.id.value,
      tenantId: input.tenantId,
      version: user.version,
    });
  }
}

@Injectable()
export class AssignRole implements UseCase<{
  userId: string;
  tenantId: string;
  role: string;
  expectedVersion?: number;
}, { userId: string; version: number }> {
  private readonly logger = new Logger(AssignRole.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_PROVIDER_PORT) private readonly idp: IdentityProviderPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { userId: string; tenantId: string; role: string; expectedVersion?: number }) {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && user.version !== input.expectedVersion) {
      const e = UserErrors.versionMismatch(input.expectedVersion, user.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const r = user.assignRole({
      tenantId: input.tenantId,
      role: input.role,
      assignedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain', r.error.details));

    await this.users.save(user);

    try {
      await this.idp.assignClientRole(user.keycloakSubject.value, input.role);
    } catch (e) {
      this.logger.warn(`Failed to assign ${input.role} in Keycloak: ${(e as Error).message}`);
    }

    return ok<{ userId: string; version: number }, ApplicationError>({
      userId: user.id.value,
      version: user.version,
    });
  }
}

@Injectable()
export class RevokeRole implements UseCase<{
  userId: string;
  tenantId: string;
  role: string;
  expectedVersion?: number;
}, { userId: string; version: number }> {
  private readonly logger = new Logger(RevokeRole.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_PROVIDER_PORT) private readonly idp: IdentityProviderPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { userId: string; tenantId: string; role: string; expectedVersion?: number }) {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }

    if (input.expectedVersion !== undefined && user.version !== input.expectedVersion) {
      const e = UserErrors.versionMismatch(input.expectedVersion, user.version);
      return err(applicationError(e.code, e.message, 'concurrency', e.details));
    }

    const r = user.revokeRole({
      tenantId: input.tenantId,
      role: input.role,
      revokedBy: this.ctx.tryGetUserId() ?? 'system',
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain', r.error.details));

    await this.users.save(user);

    try {
      await this.idp.revokeClientRole(user.keycloakSubject.value, input.role);
    } catch (e) {
      this.logger.warn(`Failed to revoke ${input.role} in Keycloak: ${(e as Error).message}`);
    }

    return ok<{ userId: string; version: number }, ApplicationError>({
      userId: user.id.value,
      version: user.version,
    });
  }
}
