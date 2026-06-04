import { DomainError, Entity, Identifier, Result, err, ok } from '@eliza/shared-kernel/domain';
import { v4 as uuidv4 } from 'uuid';

import { isKnownRole } from './role-catalog';
import { UserId } from './value-objects';

export class MembershipId extends Identifier<'Membership'> {
  private constructor(value: string) {
    super(value);
  }
  static fromString(value: string): MembershipId {
    return new MembershipId(value);
  }
  static generate(): MembershipId {
    return new MembershipId(uuidv4());
  }
}

interface MembershipProps {
  userId: UserId;
  tenantId: string; // referencia al BC Tenant — string para evitar dependencia circular
  roles: Set<string>;
  isActive: boolean;
  grantedAt: Date;
  grantedBy: string;
  revokedAt: Date | null;
  revokedBy: string | null;
}

/**
 * UserTenantMembership — entidad hija del User aggregate.
 *
 * Modela la relación M:N entre User y Tenant. Un usuario puede pertenecer
 * a varios tenants (caso típico: consultor que atiende múltiples clientes).
 *
 * Los roles se almacenan denormalizados en la membership porque son
 * propios de cada relación user↔tenant: el mismo usuario puede ser
 * Tenant.Admin en un tenant y Sales.Manager en otro.
 *
 * Keycloak guarda esto como client roles del client `eliza-api`. El
 * binding role→tenant se hace por convención de attributes en Keycloak
 * (ver KeycloakIdentityProvider).
 */
export class UserTenantMembership extends Entity<MembershipId, MembershipProps> {
  private constructor(id: MembershipId, props: MembershipProps) {
    super(id, props);
  }

  get userId(): UserId { return this.props.userId; }
  get tenantId(): string { return this.props.tenantId; }
  get roles(): ReadonlyArray<string> { return Array.from(this.props.roles); }
  get isActive(): boolean { return this.props.isActive; }
  get grantedAt(): Date { return this.props.grantedAt; }
  get grantedBy(): string { return this.props.grantedBy; }
  get revokedAt(): Date | null { return this.props.revokedAt; }
  get revokedBy(): string | null { return this.props.revokedBy; }

  static create(args: {
    userId: UserId;
    tenantId: string;
    roles: string[];
    grantedBy: string;
    now: Date;
  }): Result<UserTenantMembership, DomainError> {
    const unknownRoles = args.roles.filter((r) => !isKnownRole(r));
    if (unknownRoles.length > 0) {
      return err({
        code: 'iam.unknown_role',
        message: `Unknown roles: ${unknownRoles.join(', ')}`,
        details: { unknownRoles },
      });
    }

    return ok(new UserTenantMembership(MembershipId.generate(), {
      userId: args.userId,
      tenantId: args.tenantId,
      roles: new Set(args.roles),
      isActive: true,
      grantedAt: args.now,
      grantedBy: args.grantedBy,
      revokedAt: null,
      revokedBy: null,
    }));
  }

  static reconstitute(args: {
    id: MembershipId;
    userId: UserId;
    tenantId: string;
    roles: string[];
    isActive: boolean;
    grantedAt: Date;
    grantedBy: string;
    revokedAt: Date | null;
    revokedBy: string | null;
  }): UserTenantMembership {
    return new UserTenantMembership(args.id, {
      userId: args.userId,
      tenantId: args.tenantId,
      roles: new Set(args.roles),
      isActive: args.isActive,
      grantedAt: args.grantedAt,
      grantedBy: args.grantedBy,
      revokedAt: args.revokedAt,
      revokedBy: args.revokedBy,
    });
  }

  addRole(role: string): Result<void, DomainError> {
    if (!isKnownRole(role)) {
      return err({ code: 'iam.unknown_role', message: `Unknown role: ${role}`, details: { role } });
    }
    this.props.roles.add(role);
    return ok(undefined);
  }

  removeRole(role: string): void {
    this.props.roles.delete(role);
  }

  hasRole(role: string): boolean {
    return this.props.roles.has(role);
  }

  revoke(args: { revokedBy: string; now: Date }): void {
    this.props.isActive = false;
    this.props.revokedAt = args.now;
    this.props.revokedBy = args.revokedBy;
  }

  reactivate(): void {
    this.props.isActive = true;
    this.props.revokedAt = null;
    this.props.revokedBy = null;
  }
}
