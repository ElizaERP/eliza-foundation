import { DomainEvent } from '@eliza/shared-kernel/domain';

import { TenantPlan, TenantStatus } from '../tenant-status';

/**
 * Catálogo de eventos del bounded context Tenant.
 *
 * Convenciones:
 *   - Naming: VerboPasadoSustantivo (TenantCreated, PlanChanged)
 *   - eventType: '<context>.<EventName>.v<version>'
 *   - tenantId: en TenantCreated puede ser igual al aggregateId — el
 *     propio tenant que se está creando. Es válido.
 *   - aggregateType: siempre 'Tenant' para este BC.
 *   - eventVersion: empieza en 1; incrementa con cada breaking change.
 *
 * Alineado con el Event Catalog del Documento 9 (Event Driven).
 */

// =====================================================================
// TenantCreated
// =====================================================================
interface TenantCreatedPayload {
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly plan: TenantPlan;
  readonly status: TenantStatus;
}

export class TenantCreated extends DomainEvent {
  constructor(args: {
    aggregateId: string;
    tenantId: string;
    code: string;
    name: string;
    plan: TenantPlan;
    status: TenantStatus;
    correlationId?: string;
    userId?: string;
  }) {
    super({
      eventType: 'tenant.TenantCreated.v1',
      eventVersion: 1,
      aggregateType: 'Tenant',
      aggregateId: args.aggregateId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
    this._payload = {
      tenantId: args.tenantId,
      code: args.code,
      name: args.name,
      plan: args.plan,
      status: args.status,
    };
  }

  private readonly _payload: TenantCreatedPayload;
  payload(): TenantCreatedPayload {
    return this._payload;
  }
}

// =====================================================================
// TenantActivated
// =====================================================================
interface TenantActivatedPayload {
  readonly tenantId: string;
  readonly previousStatus: TenantStatus;
  readonly activatedAt: string;
}

export class TenantActivated extends DomainEvent {
  constructor(args: {
    tenantId: string;
    previousStatus: TenantStatus;
    activatedAt: Date;
    correlationId?: string;
    userId?: string;
  }) {
    super({
      eventType: 'tenant.TenantActivated.v1',
      eventVersion: 1,
      aggregateType: 'Tenant',
      aggregateId: args.tenantId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
    this._payload = {
      tenantId: args.tenantId,
      previousStatus: args.previousStatus,
      activatedAt: args.activatedAt.toISOString(),
    };
  }

  private readonly _payload: TenantActivatedPayload;
  payload(): TenantActivatedPayload {
    return this._payload;
  }
}

// =====================================================================
// TenantSuspended
// =====================================================================
interface TenantSuspendedPayload {
  readonly tenantId: string;
  readonly reason: string;
  readonly suspendedAt: string;
}

export class TenantSuspended extends DomainEvent {
  constructor(args: {
    tenantId: string;
    reason: string;
    suspendedAt: Date;
    correlationId?: string;
    userId?: string;
  }) {
    super({
      eventType: 'tenant.TenantSuspended.v1',
      eventVersion: 1,
      aggregateType: 'Tenant',
      aggregateId: args.tenantId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
    this._payload = {
      tenantId: args.tenantId,
      reason: args.reason,
      suspendedAt: args.suspendedAt.toISOString(),
    };
  }

  private readonly _payload: TenantSuspendedPayload;
  payload(): TenantSuspendedPayload {
    return this._payload;
  }
}

// =====================================================================
// TenantReactivated
// =====================================================================
interface TenantReactivatedPayload {
  readonly tenantId: string;
  readonly reactivatedAt: string;
}

export class TenantReactivated extends DomainEvent {
  constructor(args: {
    tenantId: string;
    reactivatedAt: Date;
    correlationId?: string;
    userId?: string;
  }) {
    super({
      eventType: 'tenant.TenantReactivated.v1',
      eventVersion: 1,
      aggregateType: 'Tenant',
      aggregateId: args.tenantId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
    this._payload = {
      tenantId: args.tenantId,
      reactivatedAt: args.reactivatedAt.toISOString(),
    };
  }

  private readonly _payload: TenantReactivatedPayload;
  payload(): TenantReactivatedPayload {
    return this._payload;
  }
}

// =====================================================================
// TenantPlanChanged
// =====================================================================
interface TenantPlanChangedPayload {
  readonly tenantId: string;
  readonly previousPlan: TenantPlan;
  readonly newPlan: TenantPlan;
  readonly changedAt: string;
}

export class TenantPlanChanged extends DomainEvent {
  constructor(args: {
    tenantId: string;
    previousPlan: TenantPlan;
    newPlan: TenantPlan;
    changedAt: Date;
    correlationId?: string;
    userId?: string;
  }) {
    super({
      eventType: 'tenant.TenantPlanChanged.v1',
      eventVersion: 1,
      aggregateType: 'Tenant',
      aggregateId: args.tenantId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
    this._payload = {
      tenantId: args.tenantId,
      previousPlan: args.previousPlan,
      newPlan: args.newPlan,
      changedAt: args.changedAt.toISOString(),
    };
  }

  private readonly _payload: TenantPlanChangedPayload;
  payload(): TenantPlanChangedPayload {
    return this._payload;
  }
}

// =====================================================================
// TenantDeleted
// =====================================================================
interface TenantDeletedPayload {
  readonly tenantId: string;
  readonly previousStatus: TenantStatus;
  readonly deletedAt: string;
}

export class TenantDeleted extends DomainEvent {
  constructor(args: {
    tenantId: string;
    previousStatus: TenantStatus;
    deletedAt: Date;
    correlationId?: string;
    userId?: string;
  }) {
    super({
      eventType: 'tenant.TenantDeleted.v1',
      eventVersion: 1,
      aggregateType: 'Tenant',
      aggregateId: args.tenantId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
    this._payload = {
      tenantId: args.tenantId,
      previousStatus: args.previousStatus,
      deletedAt: args.deletedAt.toISOString(),
    };
  }

  private readonly _payload: TenantDeletedPayload;
  payload(): TenantDeletedPayload {
    return this._payload;
  }
}
