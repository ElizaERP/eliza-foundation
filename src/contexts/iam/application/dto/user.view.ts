import { User, UserStatus } from '../../domain';

export interface MembershipView {
  id: string;
  tenantId: string;
  roles: string[];
  isActive: boolean;
  grantedAt: string;
  grantedBy: string;
  revokedAt: string | null;
}

export interface UserView {
  id: string;
  keycloakSubject: string;
  email: string;
  fullName: string;
  status: UserStatus;
  memberships: MembershipView[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt: string | null;
  version: number;
}

export function toUserView(user: User): UserView {
  return {
    id: user.id.value,
    keycloakSubject: user.keycloakSubject.value,
    email: user.email.value,
    fullName: user.fullName.value,
    status: user.status,
    memberships: user.memberships.map((m) => ({
      id: m.id.value,
      tenantId: m.tenantId,
      roles: m.roles as string[],
      isActive: m.isActive,
      grantedAt: m.grantedAt.toISOString(),
      grantedBy: m.grantedBy,
      revokedAt: m.revokedAt?.toISOString() ?? null,
    })),
    createdAt: user.createdAt.toISOString(),
    createdBy: user.createdBy,
    updatedAt: user.updatedAt.toISOString(),
    updatedBy: user.updatedBy,
    deletedAt: user.deletedAt?.toISOString() ?? null,
    version: user.version,
  };
}
