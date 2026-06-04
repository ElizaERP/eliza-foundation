import { DomainError, domainError } from '@eliza/shared-kernel/domain';

export const UserErrors = {
  emailAlreadyExists: (email: string): DomainError =>
    domainError('iam.email_already_exists', `Email '${email}' is already registered`, { email }),

  keycloakSubjectAlreadyExists: (sub: string): DomainError =>
    domainError('iam.keycloak_subject_already_exists', 'User with that Keycloak identity already exists', { sub }),

  notFound: (id: string): DomainError =>
    domainError('iam.user_not_found', `User with id '${id}' not found`, { id }),

  notFoundByEmail: (email: string): DomainError =>
    domainError('iam.user_not_found_by_email', `User with email '${email}' not found`, { email }),

  notFoundByKeycloakSubject: (sub: string): DomainError =>
    domainError('iam.user_not_found_by_keycloak_subject', `User with that Keycloak identity not found`),

  alreadyActive: (): DomainError =>
    domainError('iam.user_already_active', 'User is already active'),

  alreadySuspended: (): DomainError =>
    domainError('iam.user_already_suspended', 'User is already suspended'),

  alreadyDeleted: (): DomainError =>
    domainError('iam.user_already_deleted', 'User is deleted and cannot be modified'),

  invalidStatusTransition: (from: string, to: string): DomainError =>
    domainError('iam.invalid_user_status_transition', `Cannot transition user from '${from}' to '${to}'`, { from, to }),

  membershipNotFound: (tenantId: string): DomainError =>
    domainError('iam.membership_not_found', `User is not a member of tenant '${tenantId}'`, { tenantId }),

  membershipAlreadyExists: (tenantId: string): DomainError =>
    domainError('iam.membership_already_exists', `User is already a member of tenant '${tenantId}'`, { tenantId }),

  versionMismatch: (expected: number, actual: number): DomainError =>
    domainError(
      'iam.user_version_mismatch',
      `User was modified by another request (expected v${expected}, got v${actual})`,
      { expected, actual },
    ),
} as const;
