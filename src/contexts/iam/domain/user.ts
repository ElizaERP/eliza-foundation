import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import { UserErrors } from './errors/user.errors';
import {
  MembershipGranted,
  MembershipRevoked,
  RoleAssigned,
  RoleRevoked,
  UserActivated,
  UserCreated,
  UserDeleted,
  UserSuspended,
} from './events/user.events';
import { UserStatus, canUserTransition } from './user-status';
import { MembershipId, UserTenantMembership } from './user-tenant-membership';
import { EmailAddress, FullName, KeycloakSubject, UserId } from './value-objects';

interface UserProps {
  keycloakSubject: KeycloakSubject;
  email: EmailAddress;
  fullName: FullName;
  status: UserStatus;
  memberships: Map<string, UserTenantMembership>; // key: tenantId
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  deletedAt: Date | null;
  deletedBy: string | null;
}

/**
 * User Aggregate Root.
 *
 * Encapsula la identidad del usuario en ELIZA y todas sus membresías
 * a tenants. La identidad de autenticación vive en Keycloak (via
 * keycloakSubject); aquí mantenemos el espejo local + la relación
 * con tenants + roles asignados.
 *
 * Reglas:
 *   - Un usuario solo puede tener UNA membership por tenant
 *   - Solo usuarios Active pueden iniciar sesión efectivamente (lo
 *     enforce el JwtAuthGuard al consultar el estado tras decodificar)
 *   - Eliminar un usuario revoca todas sus membresías implícitamente
 */
export class User extends AggregateRoot<UserId, UserProps> {
  private constructor(id: UserId, props: UserProps, version: number) {
    super(id, props, version);
  }

  // -------- Getters --------
  get keycloakSubject(): KeycloakSubject { return this.props.keycloakSubject; }
  get email(): EmailAddress { return this.props.email; }
  get fullName(): FullName { return this.props.fullName; }
  get status(): UserStatus { return this.props.status; }
  get memberships(): ReadonlyArray<UserTenantMembership> {
    return Array.from(this.props.memberships.values());
  }
  get createdAt(): Date { return this.props.createdAt; }
  get createdBy(): string { return this.props.createdBy; }
  get updatedAt(): Date { return this.props.updatedAt; }
  get updatedBy(): string { return this.props.updatedBy; }
  get deletedAt(): Date | null { return this.props.deletedAt; }
  get deletedBy(): string | null { return this.props.deletedBy; }

  isActive(): boolean { return this.props.status === UserStatus.Active; }
  isSuspended(): boolean { return this.props.status === UserStatus.Suspended; }
  isDeleted(): boolean { return this.props.status === UserStatus.Deleted; }

  getMembership(tenantId: string): UserTenantMembership | undefined {
    return this.props.memberships.get(tenantId);
  }

  belongsToTenant(tenantId: string): boolean {
    const m = this.props.memberships.get(tenantId);
    return !!m && m.isActive;
  }

  // -------- Factories --------
  static create(args: {
    keycloakSubject: KeycloakSubject;
    email: EmailAddress;
    fullName: FullName;
    initialTenantId: string;
    initialRoles?: string[];
    createdBy: string;
    now: Date;
    correlationId?: string;
  }): Result<User, DomainError> {
    const id = UserId.generate();

    const props: UserProps = {
      keycloakSubject: args.keycloakSubject,
      email: args.email,
      fullName: args.fullName,
      status: UserStatus.Pending,
      memberships: new Map(),
      createdAt: args.now,
      createdBy: args.createdBy,
      updatedAt: args.now,
      updatedBy: args.createdBy,
      deletedAt: null,
      deletedBy: null,
    };

    const user = new User(id, props, 1);

    // Membership inicial si se especifica un tenant
    const membershipResult = UserTenantMembership.create({
      userId: id,
      tenantId: args.initialTenantId,
      roles: args.initialRoles ?? [],
      grantedBy: args.createdBy,
      now: args.now,
    });
    if (membershipResult.isErr) return err(membershipResult.error);

    user.props.memberships.set(args.initialTenantId, membershipResult.value);

    user.addDomainEvent(new UserCreated({
      userId: id.value,
      keycloakSubject: args.keycloakSubject.value,
      email: args.email.value,
      fullName: args.fullName.value,
      tenantId: args.initialTenantId,
      correlationId: args.correlationId,
      actorUserId: args.createdBy,
    }));

    user.addDomainEvent(new MembershipGranted({
      userId: id.value,
      tenantId: args.initialTenantId,
      membershipId: membershipResult.value.id.value,
      roles: membershipResult.value.roles as string[],
      correlationId: args.correlationId,
      actorUserId: args.createdBy,
    }));

    return ok(user);
  }

  static reconstitute(args: {
    id: UserId;
    keycloakSubject: KeycloakSubject;
    email: EmailAddress;
    fullName: FullName;
    status: UserStatus;
    memberships: UserTenantMembership[];
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
    deletedAt: Date | null;
    deletedBy: string | null;
    version: number;
  }): User {
    const map = new Map<string, UserTenantMembership>();
    for (const m of args.memberships) map.set(m.tenantId, m);

    return new User(args.id, {
      keycloakSubject: args.keycloakSubject,
      email: args.email,
      fullName: args.fullName,
      status: args.status,
      memberships: map,
      createdAt: args.createdAt,
      createdBy: args.createdBy,
      updatedAt: args.updatedAt,
      updatedBy: args.updatedBy,
      deletedAt: args.deletedAt,
      deletedBy: args.deletedBy,
    }, args.version);
  }

  // -------- Lifecycle --------
  activate(args: { activatedBy: string; now: Date; correlationId?: string }): Result<void, DomainError> {
    if (this.isDeleted()) return err(UserErrors.alreadyDeleted());
    if (this.isActive()) return err(UserErrors.alreadyActive());
    if (!canUserTransition(this.props.status, UserStatus.Active)) {
      return err(UserErrors.invalidStatusTransition(this.props.status, UserStatus.Active));
    }

    const previousStatus = this.props.status;
    this.props = { ...this.props, status: UserStatus.Active, updatedAt: args.now, updatedBy: args.activatedBy };
    this.incrementVersion();

    const firstTenantId = this.memberships[0]?.tenantId ?? 'unknown';
    this.addDomainEvent(new UserActivated({
      userId: this._id.value,
      previousStatus,
      tenantId: firstTenantId,
      activatedAt: args.now,
      correlationId: args.correlationId,
      actorUserId: args.activatedBy,
    }));

    return ok(undefined);
  }

  suspend(args: { reason: string; suspendedBy: string; now: Date; correlationId?: string }): Result<void, DomainError> {
    if (this.isDeleted()) return err(UserErrors.alreadyDeleted());
    if (this.isSuspended()) return err(UserErrors.alreadySuspended());
    if (!canUserTransition(this.props.status, UserStatus.Suspended)) {
      return err(UserErrors.invalidStatusTransition(this.props.status, UserStatus.Suspended));
    }

    this.props = { ...this.props, status: UserStatus.Suspended, updatedAt: args.now, updatedBy: args.suspendedBy };
    this.incrementVersion();

    const firstTenantId = this.memberships[0]?.tenantId ?? 'unknown';
    this.addDomainEvent(new UserSuspended({
      userId: this._id.value,
      reason: args.reason,
      tenantId: firstTenantId,
      suspendedAt: args.now,
      correlationId: args.correlationId,
      actorUserId: args.suspendedBy,
    }));

    return ok(undefined);
  }

  delete(args: { deletedBy: string; now: Date; correlationId?: string }): Result<void, DomainError> {
    if (this.isDeleted()) return err(UserErrors.alreadyDeleted());
    if (!canUserTransition(this.props.status, UserStatus.Deleted)) {
      return err(UserErrors.invalidStatusTransition(this.props.status, UserStatus.Deleted));
    }

    const previousStatus = this.props.status;
    this.props = {
      ...this.props,
      status: UserStatus.Deleted,
      updatedAt: args.now,
      updatedBy: args.deletedBy,
      deletedAt: args.now,
      deletedBy: args.deletedBy,
    };
    // Revocar todas las membresías
    for (const m of this.props.memberships.values()) {
      if (m.isActive) m.revoke({ revokedBy: args.deletedBy, now: args.now });
    }
    this.incrementVersion();

    const firstTenantId = this.memberships[0]?.tenantId ?? 'unknown';
    this.addDomainEvent(new UserDeleted({
      userId: this._id.value,
      previousStatus,
      tenantId: firstTenantId,
      deletedAt: args.now,
      correlationId: args.correlationId,
      actorUserId: args.deletedBy,
    }));

    return ok(undefined);
  }

  // -------- Memberships --------
  grantMembership(args: {
    tenantId: string;
    roles: string[];
    grantedBy: string;
    now: Date;
    correlationId?: string;
  }): Result<UserTenantMembership, DomainError> {
    if (this.isDeleted()) return err(UserErrors.alreadyDeleted());

    const existing = this.props.memberships.get(args.tenantId);
    if (existing && existing.isActive) {
      return err(UserErrors.membershipAlreadyExists(args.tenantId));
    }

    if (existing && !existing.isActive) {
      // Reactivar la existente y opcionalmente agregar roles
      existing.reactivate();
      for (const role of args.roles) {
        const r = existing.addRole(role);
        if (r.isErr) return err(r.error);
      }
      this.props.updatedAt = args.now;
      this.props.updatedBy = args.grantedBy;
      this.incrementVersion();

      this.addDomainEvent(new MembershipGranted({
        userId: this._id.value,
        tenantId: args.tenantId,
        membershipId: existing.id.value,
        roles: existing.roles as string[],
        correlationId: args.correlationId,
        actorUserId: args.grantedBy,
      }));

      return ok(existing);
    }

    const newMembership = UserTenantMembership.create({
      userId: this._id,
      tenantId: args.tenantId,
      roles: args.roles,
      grantedBy: args.grantedBy,
      now: args.now,
    });
    if (newMembership.isErr) return err(newMembership.error);

    this.props.memberships.set(args.tenantId, newMembership.value);
    this.props.updatedAt = args.now;
    this.props.updatedBy = args.grantedBy;
    this.incrementVersion();

    this.addDomainEvent(new MembershipGranted({
      userId: this._id.value,
      tenantId: args.tenantId,
      membershipId: newMembership.value.id.value,
      roles: args.roles,
      correlationId: args.correlationId,
      actorUserId: args.grantedBy,
    }));

    return ok(newMembership.value);
  }

  revokeMembership(args: {
    tenantId: string;
    revokedBy: string;
    now: Date;
    correlationId?: string;
  }): Result<void, DomainError> {
    if (this.isDeleted()) return err(UserErrors.alreadyDeleted());

    const m = this.props.memberships.get(args.tenantId);
    if (!m || !m.isActive) return err(UserErrors.membershipNotFound(args.tenantId));

    m.revoke({ revokedBy: args.revokedBy, now: args.now });
    this.props.updatedAt = args.now;
    this.props.updatedBy = args.revokedBy;
    this.incrementVersion();

    this.addDomainEvent(new MembershipRevoked({
      userId: this._id.value,
      tenantId: args.tenantId,
      membershipId: m.id.value,
      correlationId: args.correlationId,
      actorUserId: args.revokedBy,
    }));

    return ok(undefined);
  }

  assignRole(args: {
    tenantId: string;
    role: string;
    assignedBy: string;
    now: Date;
    correlationId?: string;
  }): Result<void, DomainError> {
    if (this.isDeleted()) return err(UserErrors.alreadyDeleted());

    const m = this.props.memberships.get(args.tenantId);
    if (!m || !m.isActive) return err(UserErrors.membershipNotFound(args.tenantId));

    const r = m.addRole(args.role);
    if (r.isErr) return err(r.error);

    this.props.updatedAt = args.now;
    this.props.updatedBy = args.assignedBy;
    this.incrementVersion();

    this.addDomainEvent(new RoleAssigned({
      userId: this._id.value,
      tenantId: args.tenantId,
      role: args.role,
      correlationId: args.correlationId,
      actorUserId: args.assignedBy,
    }));

    return ok(undefined);
  }

  revokeRole(args: {
    tenantId: string;
    role: string;
    revokedBy: string;
    now: Date;
    correlationId?: string;
  }): Result<void, DomainError> {
    if (this.isDeleted()) return err(UserErrors.alreadyDeleted());

    const m = this.props.memberships.get(args.tenantId);
    if (!m || !m.isActive) return err(UserErrors.membershipNotFound(args.tenantId));

    m.removeRole(args.role);
    this.props.updatedAt = args.now;
    this.props.updatedBy = args.revokedBy;
    this.incrementVersion();

    this.addDomainEvent(new RoleRevoked({
      userId: this._id.value,
      tenantId: args.tenantId,
      role: args.role,
      correlationId: args.correlationId,
      actorUserId: args.revokedBy,
    }));

    return ok(undefined);
  }

  /** Marca al usuario como "Active" sin emitir evento — usado al sincronizar desde Keycloak. */
  markActiveFromExternal(args: { now: Date; updatedBy: string }): void {
    if (this.isDeleted()) return;
    this.props = { ...this.props, status: UserStatus.Active, updatedAt: args.now, updatedBy: args.updatedBy };
  }
}
