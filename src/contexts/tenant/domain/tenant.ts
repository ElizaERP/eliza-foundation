import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  TenantActivated,
  TenantCreated,
  TenantDeleted,
  TenantPlanChanged,
  TenantReactivated,
  TenantSuspended,
} from './events/tenant.events';
import { TenantErrors } from './errors/tenant.errors';
import { TenantCode } from './tenant-code';
import { TenantId } from './tenant-id';
import { TenantName } from './tenant-name';
import { TenantPlan, TenantStatus, canTransition } from './tenant-status';

interface TenantProps {
  code: TenantCode;
  name: TenantName;
  status: TenantStatus;
  plan: TenantPlan;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  deletedAt: Date | null;
  deletedBy: string | null;
}

/**
 * Tenant — Aggregate Root del bounded context Tenant Management.
 *
 * Encapsula el ciclo de vida del tenant en la plataforma SaaS ELIZA.
 * Es responsable de mantener sus propias invariantes y de emitir
 * domain events cuando su estado cambia.
 *
 * Cómo se crea: vía `Tenant.create(...)` (factory). El constructor es
 * privado para forzar que toda creación pase por la validación.
 *
 * Cómo se reconstituye: vía `Tenant.reconstitute(...)` que usa el
 * repositorio Prisma al cargar desde la base. Esta vía NO emite eventos
 * porque el estado ya está persistido.
 */
export class Tenant extends AggregateRoot<TenantId, TenantProps> {
  private constructor(id: TenantId, props: TenantProps, version: number) {
    super(id, props, version);
  }

  // -------- Getters --------
  get code(): TenantCode { return this.props.code; }
  get name(): TenantName { return this.props.name; }
  get status(): TenantStatus { return this.props.status; }
  get plan(): TenantPlan { return this.props.plan; }
  get createdAt(): Date { return this.props.createdAt; }
  get createdBy(): string { return this.props.createdBy; }
  get updatedAt(): Date { return this.props.updatedAt; }
  get updatedBy(): string { return this.props.updatedBy; }
  get deletedAt(): Date | null { return this.props.deletedAt; }
  get deletedBy(): string | null { return this.props.deletedBy; }

  isActive(): boolean { return this.props.status === TenantStatus.Active; }
  isSuspended(): boolean { return this.props.status === TenantStatus.Suspended; }
  isDeleted(): boolean { return this.props.status === TenantStatus.Deleted; }
  isPending(): boolean { return this.props.status === TenantStatus.PendingActivation; }

  // -------- Factory: nueva creación --------
  /**
   * Provisiona un nuevo Tenant en estado PendingActivation.
   * Solo el Platform Admin invoca este flujo (RBAC enforced en el use case).
   */
  static create(args: {
    code: TenantCode;
    name: TenantName;
    plan?: TenantPlan;
    createdBy: string;
    now: Date;
    correlationId?: string;
  }): Result<Tenant, DomainError> {
    const id = TenantId.generate();
    const plan = args.plan ?? TenantPlan.Basic;

    const props: TenantProps = {
      code: args.code,
      name: args.name,
      status: TenantStatus.PendingActivation,
      plan,
      createdAt: args.now,
      createdBy: args.createdBy,
      updatedAt: args.now,
      updatedBy: args.createdBy,
      deletedAt: null,
      deletedBy: null,
    };

    const tenant = new Tenant(id, props, 1);

    tenant.addDomainEvent(
      new TenantCreated({
        aggregateId: id.value,
        tenantId: id.value,
        code: args.code.value,
        name: args.name.value,
        plan,
        status: TenantStatus.PendingActivation,
        correlationId: args.correlationId,
        userId: args.createdBy,
      }),
    );

    return ok(tenant);
  }

  // -------- Factory: reconstitución desde persistencia --------
  /**
   * Reconstruye un Tenant desde la base. NO emite eventos.
   * Solo lo invoca el repositorio Prisma vía el mapper.
   */
  static reconstitute(args: {
    id: TenantId;
    code: TenantCode;
    name: TenantName;
    status: TenantStatus;
    plan: TenantPlan;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
    deletedAt: Date | null;
    deletedBy: string | null;
    version: number;
  }): Tenant {
    return new Tenant(
      args.id,
      {
        code: args.code,
        name: args.name,
        status: args.status,
        plan: args.plan,
        createdAt: args.createdAt,
        createdBy: args.createdBy,
        updatedAt: args.updatedAt,
        updatedBy: args.updatedBy,
        deletedAt: args.deletedAt,
        deletedBy: args.deletedBy,
      },
      args.version,
    );
  }

  // -------- Comportamientos del agregado --------

  /**
   * Activa un tenant que estaba PendingActivation o Suspended.
   * - PendingActivation → Active emite TenantActivated
   * - Suspended         → Active emite TenantReactivated
   */
  activate(args: { activatedBy: string; now: Date; correlationId?: string }): Result<void, DomainError> {
    if (this.isDeleted()) return err(TenantErrors.alreadyDeleted());
    if (this.isActive()) return err(TenantErrors.alreadyActive());

    if (!canTransition(this.props.status, TenantStatus.Active)) {
      return err(TenantErrors.invalidStatusTransition(this.props.status, TenantStatus.Active));
    }

    const previousStatus = this.props.status;
    this.props = {
      ...this.props,
      status: TenantStatus.Active,
      updatedAt: args.now,
      updatedBy: args.activatedBy,
    };
    this.incrementVersion();

    if (previousStatus === TenantStatus.Suspended) {
      this.addDomainEvent(new TenantReactivated({
        tenantId: this._id.value,
        reactivatedAt: args.now,
        correlationId: args.correlationId,
        userId: args.activatedBy,
      }));
    } else {
      this.addDomainEvent(new TenantActivated({
        tenantId: this._id.value,
        previousStatus,
        activatedAt: args.now,
        correlationId: args.correlationId,
        userId: args.activatedBy,
      }));
    }

    return ok(undefined);
  }

  /** Suspende un tenant Active. */
  suspend(args: {
    reason: string;
    suspendedBy: string;
    now: Date;
    correlationId?: string;
  }): Result<void, DomainError> {
    if (this.isDeleted()) return err(TenantErrors.alreadyDeleted());
    if (this.isSuspended()) return err(TenantErrors.alreadySuspended());

    if (!canTransition(this.props.status, TenantStatus.Suspended)) {
      return err(TenantErrors.invalidStatusTransition(this.props.status, TenantStatus.Suspended));
    }

    this.props = {
      ...this.props,
      status: TenantStatus.Suspended,
      updatedAt: args.now,
      updatedBy: args.suspendedBy,
    };
    this.incrementVersion();

    this.addDomainEvent(new TenantSuspended({
      tenantId: this._id.value,
      reason: args.reason,
      suspendedAt: args.now,
      correlationId: args.correlationId,
      userId: args.suspendedBy,
    }));

    return ok(undefined);
  }

  /**
   * Cambia el plan del tenant. Solo permitido si el tenant está
   * Active o Suspended (no pending ni deleted).
   */
  changePlan(args: {
    newPlan: TenantPlan;
    changedBy: string;
    now: Date;
    correlationId?: string;
  }): Result<void, DomainError> {
    if (this.isDeleted()) return err(TenantErrors.alreadyDeleted());
    if (this.isPending()) {
      return err(TenantErrors.cannotChangePlanInStatus(this.props.status));
    }
    if (this.props.plan === args.newPlan) {
      return err(TenantErrors.samePlan(args.newPlan));
    }

    const previousPlan = this.props.plan;
    this.props = {
      ...this.props,
      plan: args.newPlan,
      updatedAt: args.now,
      updatedBy: args.changedBy,
    };
    this.incrementVersion();

    this.addDomainEvent(new TenantPlanChanged({
      tenantId: this._id.value,
      previousPlan,
      newPlan: args.newPlan,
      changedAt: args.now,
      correlationId: args.correlationId,
      userId: args.changedBy,
    }));

    return ok(undefined);
  }

  /** Marca el tenant como Deleted (soft delete). Operación terminal. */
  delete(args: { deletedBy: string; now: Date; correlationId?: string }): Result<void, DomainError> {
    if (this.isDeleted()) return err(TenantErrors.alreadyDeleted());

    if (!canTransition(this.props.status, TenantStatus.Deleted)) {
      return err(TenantErrors.invalidStatusTransition(this.props.status, TenantStatus.Deleted));
    }

    const previousStatus = this.props.status;
    this.props = {
      ...this.props,
      status: TenantStatus.Deleted,
      updatedAt: args.now,
      updatedBy: args.deletedBy,
      deletedAt: args.now,
      deletedBy: args.deletedBy,
    };
    this.incrementVersion();

    this.addDomainEvent(new TenantDeleted({
      tenantId: this._id.value,
      previousStatus,
      deletedAt: args.now,
      correlationId: args.correlationId,
      userId: args.deletedBy,
    }));

    return ok(undefined);
  }

  /** Actualiza el nombre. No es una transición de estado, no emite evento. */
  rename(args: {
    newName: TenantName;
    renamedBy: string;
    now: Date;
  }): Result<void, DomainError> {
    if (this.isDeleted()) return err(TenantErrors.alreadyDeleted());

    this.props = {
      ...this.props,
      name: args.newName,
      updatedAt: args.now,
      updatedBy: args.renamedBy,
    };
    this.incrementVersion();
    return ok(undefined);
  }
}
