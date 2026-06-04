import { DomainEvent } from '@eliza/shared-kernel/domain';

import { UserStatus } from '../user-status';

// =====================================================================
// UserCreated
// =====================================================================
export class UserCreated extends DomainEvent {
  constructor(args: {
    userId: string;
    keycloakSubject: string;
    email: string;
    fullName: string;
    tenantId: string;
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.UserCreated.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = {
      userId: args.userId,
      keycloakSubject: args.keycloakSubject,
      email: args.email,
      fullName: args.fullName,
    };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}

// =====================================================================
// UserStatusChanged (genérico para Active/Suspended/Reactivated)
// =====================================================================
export class UserActivated extends DomainEvent {
  constructor(args: {
    userId: string;
    previousStatus: UserStatus;
    tenantId: string;
    activatedAt: Date;
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.UserActivated.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = {
      userId: args.userId,
      previousStatus: args.previousStatus,
      activatedAt: args.activatedAt.toISOString(),
    };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}

export class UserSuspended extends DomainEvent {
  constructor(args: {
    userId: string;
    reason: string;
    tenantId: string;
    suspendedAt: Date;
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.UserSuspended.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = {
      userId: args.userId,
      reason: args.reason,
      suspendedAt: args.suspendedAt.toISOString(),
    };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}

export class UserDeleted extends DomainEvent {
  constructor(args: {
    userId: string;
    previousStatus: UserStatus;
    tenantId: string;
    deletedAt: Date;
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.UserDeleted.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = {
      userId: args.userId,
      previousStatus: args.previousStatus,
      deletedAt: args.deletedAt.toISOString(),
    };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}

// =====================================================================
// MembershipGranted / MembershipRevoked
// =====================================================================
export class MembershipGranted extends DomainEvent {
  constructor(args: {
    userId: string;
    tenantId: string;
    membershipId: string;
    roles: string[];
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.MembershipGranted.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = {
      userId: args.userId,
      tenantId: args.tenantId,
      membershipId: args.membershipId,
      roles: args.roles,
    };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}

export class MembershipRevoked extends DomainEvent {
  constructor(args: {
    userId: string;
    tenantId: string;
    membershipId: string;
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.MembershipRevoked.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = {
      userId: args.userId,
      tenantId: args.tenantId,
      membershipId: args.membershipId,
    };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}

// =====================================================================
// RoleAssigned / RoleRevoked
// =====================================================================
export class RoleAssigned extends DomainEvent {
  constructor(args: {
    userId: string;
    tenantId: string;
    role: string;
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.RoleAssigned.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = { userId: args.userId, tenantId: args.tenantId, role: args.role };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}

export class RoleRevoked extends DomainEvent {
  constructor(args: {
    userId: string;
    tenantId: string;
    role: string;
    correlationId?: string;
    actorUserId?: string;
  }) {
    super({
      eventType: 'iam.RoleRevoked.v1',
      eventVersion: 1,
      aggregateType: 'User',
      aggregateId: args.userId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.actorUserId,
    });
    this._payload = { userId: args.userId, tenantId: args.tenantId, role: args.role };
  }
  private readonly _payload: object;
  payload() { return this._payload as Record<string, unknown>; }
}
