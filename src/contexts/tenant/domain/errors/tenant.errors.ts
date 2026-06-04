import { DomainError, domainError } from '@eliza/shared-kernel/domain';

/**
 * Catálogo central de errores del dominio Tenant.
 *
 * Los códigos siguen el formato '<context>.<concept>.<reason>' y son
 * estables: forman parte del contrato público de la API y los clientes
 * pueden ramificar lógica sobre ellos.
 */
export const TenantErrors = {
  codeAlreadyExists: (code: string): DomainError =>
    domainError(
      'tenant.code.already_exists',
      `A tenant with code '${code}' already exists`,
      { code },
    ),

  notFound: (id: string): DomainError =>
    domainError('tenant.not_found', `Tenant with id '${id}' not found`, { id }),

  notFoundByCode: (code: string): DomainError =>
    domainError('tenant.not_found_by_code', `Tenant with code '${code}' not found`, { code }),

  invalidStatusTransition: (from: string, to: string): DomainError =>
    domainError(
      'tenant.invalid_status_transition',
      `Cannot transition tenant from '${from}' to '${to}'`,
      { from, to },
    ),

  alreadyActive: (): DomainError =>
    domainError('tenant.already_active', 'Tenant is already active'),

  alreadySuspended: (): DomainError =>
    domainError('tenant.already_suspended', 'Tenant is already suspended'),

  alreadyDeleted: (): DomainError =>
    domainError(
      'tenant.already_deleted',
      'Tenant is deleted and cannot be modified',
    ),

  cannotChangePlanInStatus: (status: string): DomainError =>
    domainError(
      'tenant.cannot_change_plan',
      `Tenant plan cannot change while status is '${status}'`,
      { status },
    ),

  samePlan: (plan: string): DomainError =>
    domainError(
      'tenant.same_plan',
      `Tenant is already on plan '${plan}'`,
      { plan },
    ),

  versionMismatch: (expected: number, actual: number): DomainError =>
    domainError(
      'tenant.version_mismatch',
      `Tenant was modified by another request (expected v${expected}, got v${actual})`,
      { expected, actual },
    ),
} as const;
