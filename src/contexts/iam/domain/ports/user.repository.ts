import { User } from '../user';
import { EmailAddress, KeycloakSubject, UserId } from '../value-objects';

/**
 * UserRepository port — persistencia local del usuario en ELIZA.
 */
export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: EmailAddress): Promise<User | null>;
  findByKeycloakSubject(sub: KeycloakSubject): Promise<User | null>;
  existsByEmail(email: EmailAddress): Promise<boolean>;
  save(user: User): Promise<void>;
  listByTenant(opts: { tenantId: string; page?: number; pageSize?: number; search?: string }): Promise<{
    items: User[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>;
}

export const USER_REPOSITORY = Symbol('UserRepository');

/**
 * IdentityProvider port — abstrae el provider de identidad externo
 * (Keycloak en producción; mock en tests).
 *
 * Es un driven port (secundario): la aplicación lo NECESITA para crear
 * y modificar identidades en el sistema federado. La implementación
 * concreta (KeycloakIdentityProvider) usa la Admin API REST de Keycloak.
 *
 * Operaciones idempotentes donde sea posible. Las fallas deben ser
 * recuperables o compensables (saga pattern).
 */
export interface IdentityProviderPort {
  /**
   * Crea un usuario en Keycloak. Devuelve el `sub` (subject) asignado.
   * Si el email ya existe, devuelve un error específico para compensación.
   */
  createUser(args: {
    email: string;
    fullName: string;
    temporaryPassword?: string;
    enabled?: boolean;
    attributes?: Record<string, string[]>;
  }): Promise<IdentityCreateResult>;

  /** Elimina un usuario en Keycloak (compensación si falla la persistencia local). */
  deleteUser(keycloakSubject: string): Promise<void>;

  /** Habilita/deshabilita login en Keycloak (espejo de UserStatus). */
  setUserEnabled(keycloakSubject: string, enabled: boolean): Promise<void>;

  /** Asigna un client role del cliente `eliza-api` al usuario. */
  assignClientRole(keycloakSubject: string, role: string): Promise<void>;

  /** Revoca un client role. */
  revokeClientRole(keycloakSubject: string, role: string): Promise<void>;

  /** Actualiza atributos custom del usuario (tenant_id, plant_id, warehouse_id). */
  updateUserAttributes(keycloakSubject: string, attributes: Record<string, string[]>): Promise<void>;

  /** Envía email de "establecer contraseña inicial". */
  sendPasswordResetEmail(keycloakSubject: string): Promise<void>;
}

export interface IdentityCreateResult {
  keycloakSubject: string;
  email: string;
}

export const IDENTITY_PROVIDER_PORT = Symbol('IdentityProviderPort');
