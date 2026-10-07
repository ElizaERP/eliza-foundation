import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  EmailAddress,
  FullName,
  IDENTITY_PROVIDER_PORT,
  IdentityProviderPort,
  KeycloakSubject,
  USER_REPOSITORY,
  User,
  UserErrors,
  UserRepository,
} from '../../domain';
import { UserView, toUserView } from '../dto/user.view';

export interface CreateUserInput {
  email: string;
  fullName: string;
  tenantId: string;
  roles?: string[];
  sendActivationEmail?: boolean;
}

/**
 * CreateUser — saga de dos pasos: provisiona la identidad en Keycloak
 * y luego persiste el espejo en ELIZA. Si la persistencia falla,
 * compensa eliminando la identidad recién creada en Keycloak.
 *
 * Operación de Tenant Admin: crea un usuario DENTRO de su tenant.
 * Platform Admin también puede crearlo en cualquier tenant.
 */
@Injectable()
export class CreateUser implements UseCase<CreateUserInput, UserView> {
  private readonly logger = new Logger(CreateUser.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(IDENTITY_PROVIDER_PORT) private readonly idp: IdentityProviderPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateUserInput): Promise<Result<UserView, ApplicationError>> {
    // ---- 1. Validar VOs ----
    const emailR = EmailAddress.create(input.email);
    if (emailR.isErr) {
      return err(applicationError(emailR.error.code, emailR.error.message, 'validation', emailR.error.details));
    }
    const email = emailR.value;

    const fullNameR = FullName.create(input.fullName);
    if (fullNameR.isErr) {
      return err(applicationError(fullNameR.error.code, fullNameR.error.message, 'validation', fullNameR.error.details));
    }
    const fullName = fullNameR.value;

    // ---- 2. Unicidad de email en ELIZA ----
    if (await this.users.existsByEmail(email)) {
      const e = UserErrors.emailAlreadyExists(email.value);
      return err(applicationError(e.code, e.message, 'conflict', e.details));
    }

    // ---- 3. Provisionar identidad en Keycloak ----
    let keycloakSubject: string;
    try {
      const result = await this.idp.createUser({
        email: email.value,
        fullName: fullName.value,
        enabled: false, // se habilita cuando se activa
        attributes: {
          tenant_id: [input.tenantId],
        },
      });
      keycloakSubject = result.keycloakSubject;
      this.logger.log(`Keycloak user created for ${email.value}: sub=${keycloakSubject}`);
    } catch (e) {
      this.logger.error(`Keycloak user creation failed for ${email.value}`, e);
      return err(applicationError(
        'iam.idp_create_failed',
        `Identity provider failed to create user: ${(e as Error).message}`,
        'infrastructure',
      ));
    }

    // ---- 4. Construir agregado local ----
    const subR = KeycloakSubject.create(keycloakSubject);
    if (subR.isErr) {
      // Compensación: rollback en Keycloak
      await this.compensate(keycloakSubject, 'invalid sub returned by IDP');
      return err(applicationError(subR.error.code, subR.error.message, 'infrastructure', subR.error.details));
    }

    const createdBy = this.ctx.tryGetUserId() ?? 'system';
    const userR = User.create({
      keycloakSubject: subR.value,
      email,
      fullName,
      initialTenantId: input.tenantId,
      initialRoles: input.roles ?? [],
      createdBy,
      now: this.clock.now(),
      correlationId: this.ctx.getCorrelationId(),
    });
    if (userR.isErr) {
      await this.compensate(keycloakSubject, 'domain error after IDP create');
      return err(applicationError(userR.error.code, userR.error.message, 'domain', userR.error.details));
    }
    const user = userR.value;

    // ---- 5. Persistir + asignar roles en Keycloak ----
    try {
      await this.users.save(user);

      // Asignación de roles best-effort: si falla, el usuario sigue
      // existiendo pero sin roles. Audit log lo verá.
      for (const role of input.roles ?? []) {
        try {
          await this.idp.assignRole(keycloakSubject, role);
        } catch (e) {
          this.logger.warn(`Failed to assign role ${role} in Keycloak for ${email.value}: ${(e as Error).message}`);
        }
      }

      // Envío de email de bienvenida (best-effort)
      if (input.sendActivationEmail) {
        try {
          await this.idp.sendPasswordResetEmail(keycloakSubject);
        } catch (e) {
          this.logger.warn(`Failed to send activation email: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      // ROLLBACK CRÍTICO: si la BD falla, compensamos en Keycloak
      await this.compensate(keycloakSubject, `local persist failed: ${(e as Error).message}`);
      return err(applicationError(
        'iam.user_persist_failed',
        `Failed to persist user in local store: ${(e as Error).message}`,
        'infrastructure',
      ));
    }

    return ok(toUserView(user));
  }

  private async compensate(keycloakSubject: string, reason: string): Promise<void> {
    this.logger.warn(`Compensating Keycloak user ${keycloakSubject}: ${reason}`);
    try {
      await this.idp.deleteUser(keycloakSubject);
    } catch (e) {
      // Si la compensación también falla, queda un "orphan" en Keycloak.
      // Es preferible loggear que ocultar el problema.
      this.logger.error(
        `ORPHAN: Could not compensate Keycloak user ${keycloakSubject}. ` +
        `Manual cleanup required. Error: ${(e as Error).message}`,
      );
    }
  }
}
