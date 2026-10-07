import { Injectable } from '@nestjs/common';

import { IdentityCreateResult, IdentityProviderPort } from '../../domain';
import { KeycloakAdminClient } from './keycloak-admin.client';

/**
 * Implementación del IdentityProviderPort sobre Keycloak.
 *
 * Cumple el contrato del puerto traduciendo cada operación a llamadas
 * a la Admin API de Keycloak. Sin lógica de negocio — solo traducción.
 */
@Injectable()
export class KeycloakIdentityProvider implements IdentityProviderPort {
  constructor(private readonly kc: KeycloakAdminClient) {}

  async createUser(args: {
    email: string;
    fullName: string;
    temporaryPassword?: string;
    enabled?: boolean;
    attributes?: Record<string, string[]>;
  }): Promise<IdentityCreateResult> {
    const keycloakSubject = await this.kc.createUser({
      email: args.email,
      fullName: args.fullName,
      enabled: args.enabled ?? false,
      attributes: args.attributes,
      temporaryPassword: args.temporaryPassword,
    });

    return {
      keycloakSubject,
      email: args.email,
    };
  }

  async deleteUser(keycloakSubject: string): Promise<void> {
    await this.kc.deleteUser(keycloakSubject);
  }

  async setUserEnabled(keycloakSubject: string, enabled: boolean): Promise<void> {
    await this.kc.setUserEnabled(keycloakSubject, enabled);
  }

  async assignRole(keycloakSubject: string, role: string): Promise<void> {
    await this.kc.assignRealmRole(keycloakSubject, role);
  }

  async revokeRole(keycloakSubject: string, role: string): Promise<void> {
    await this.kc.revokeRealmRole(keycloakSubject, role);
  }

  async updateUserAttributes(
    keycloakSubject: string,
    attributes: Record<string, string[]>,
  ): Promise<void> {
    await this.kc.updateUserAttributes(keycloakSubject, attributes);
  }

  async sendPasswordResetEmail(keycloakSubject: string): Promise<void> {
    await this.kc.sendActionsEmail(keycloakSubject, ['UPDATE_PASSWORD', 'VERIFY_EMAIL']);
  }
}
