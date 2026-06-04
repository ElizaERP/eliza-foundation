import {
  User as PrismaUser,
  UserStatus as PrismaUserStatus,
  UserTenantMembership as PrismaMembership,
} from '@prisma/client';

import {
  EmailAddress,
  FullName,
  KeycloakSubject,
  MembershipId,
  User,
  UserId,
  UserStatus,
  UserTenantMembership,
} from '../../domain';

/**
 * Mapper User ↔ Prisma.
 *
 * Estrategia para los roles de la membership: como Prisma no tiene una
 * tabla `membership_roles` aún, los roles viven en Keycloak y se
 * "espejan" en una columna JSON de UserTenantMembership. Para Sprint 2
 * los persistimos como JSON en una columna `rolesJson` que añadiremos
 * en la migración (ver más abajo).
 */

type PrismaMembershipWithRoles = PrismaMembership & { rolesJson?: unknown };
type PrismaUserWithMemberships = PrismaUser & { memberships?: PrismaMembershipWithRoles[] };

export class UserMapper {
  static toDomain(row: PrismaUserWithMemberships): User {
    const email = EmailAddress.create(row.email);
    const fullName = FullName.create(row.fullName);
    const sub = KeycloakSubject.create(row.keycloakSubject);

    if (email.isErr || fullName.isErr || sub.isErr) {
      throw new Error(`Persisted User ${row.id} violates invariants`);
    }

    const memberships = (row.memberships ?? []).map((m) =>
      UserTenantMembership.reconstitute({
        id: MembershipId.fromString(m.id),
        userId: UserId.fromString(m.userId),
        tenantId: m.tenantId,
        roles: Array.isArray(m.rolesJson) ? (m.rolesJson as string[]) : [],
        isActive: m.isActive,
        grantedAt: m.createdAt,
        grantedBy: m.createdBy,
        revokedAt: m.isActive ? null : m.updatedAt,
        revokedBy: m.isActive ? null : m.updatedBy,
      }),
    );

    return User.reconstitute({
      id: UserId.fromString(row.id),
      keycloakSubject: sub.value,
      email: email.value,
      fullName: fullName.value,
      status: row.status as unknown as UserStatus,
      memberships,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      deletedAt: row.deletedAt,
      deletedBy: row.deletedBy,
      version: row.version,
    });
  }

  static toPersistence(user: User): {
    user: {
      id: string;
      keycloakSubject: string;
      email: string;
      fullName: string;
      status: PrismaUserStatus;
      createdAt: Date;
      createdBy: string;
      updatedAt: Date;
      updatedBy: string;
      deletedAt: Date | null;
      deletedBy: string | null;
      version: number;
    };
    memberships: Array<{
      id: string;
      userId: string;
      tenantId: string;
      isActive: boolean;
      rolesJson: string[];
      createdAt: Date;
      createdBy: string;
      updatedAt: Date;
      updatedBy: string;
      version: number;
    }>;
  } {
    return {
      user: {
        id: user.id.value,
        keycloakSubject: user.keycloakSubject.value,
        email: user.email.value,
        fullName: user.fullName.value,
        status: user.status as unknown as PrismaUserStatus,
        createdAt: user.createdAt,
        createdBy: user.createdBy,
        updatedAt: user.updatedAt,
        updatedBy: user.updatedBy,
        deletedAt: user.deletedAt,
        deletedBy: user.deletedBy,
        version: user.version,
      },
      memberships: user.memberships.map((m) => ({
        id: m.id.value,
        userId: m.userId.value,
        tenantId: m.tenantId,
        isActive: m.isActive,
        rolesJson: m.roles as string[],
        createdAt: m.grantedAt,
        createdBy: m.grantedBy,
        updatedAt: m.revokedAt ?? m.grantedAt,
        updatedBy: m.revokedBy ?? m.grantedBy,
        version: 1,
      })),
    };
  }
}
