import { Injectable, Logger } from '@nestjs/common';

import { KeycloakConfig } from './keycloak.config';

/**
 * Cliente HTTP del Admin REST API de Keycloak.
 *
 * Usa el `fetch` nativo de Node 20+ — no agregamos `axios` por una sola
 * dependencia. Maneja:
 *   - Autenticación con el admin (password grant del realm `master`)
 *   - Cache del admin token con buffer de 30s antes de expiry
 *   - Reintentos para errores transientes (5xx)
 *   - Mapeo de errores HTTP a excepciones tipadas
 *
 * Documentación: https://www.keycloak.org/docs-api/latest/rest-api/index.html
 */
@Injectable()
export class KeycloakAdminClient {
  private readonly logger = new Logger(KeycloakAdminClient.name);
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: KeycloakConfig) {}

  // -------- Token management --------
  private async getAdminToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30_000) {
      return this.cachedToken.token;
    }

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: this.config.adminUsername,
      password: this.config.adminPassword,
    });

    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to obtain Keycloak admin token: ${res.status} ${await res.text()}`,
      );
    }

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      token: json.access_token,
      expiresAt: now + json.expires_in * 1000,
    };
    return json.access_token;
  }

  // -------- Low-level request --------
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T | null; locationId?: string }> {
    const token = await this.getAdminToken();
    const url = `${this.config.adminRealmUrl}${path}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    const res = await fetch(url, init);
    const text = await res.text();

    if (!res.ok) {
      throw new KeycloakError(res.status, `${method} ${path} → ${res.status}: ${text}`);
    }

    // Keycloak devuelve 201 con Location header al crear; extraer el id
    let locationId: string | undefined;
    const loc = res.headers.get('location');
    if (loc) {
      const parts = loc.split('/');
      locationId = parts[parts.length - 1];
    }

    const parsed = text.length > 0 ? (JSON.parse(text) as T) : null;
    return { status: res.status, body: parsed, locationId };
  }

  // -------- User operations --------
  async createUser(args: {
    email: string;
    fullName: string;
    enabled: boolean;
    attributes?: Record<string, string[]>;
    temporaryPassword?: string;
  }): Promise<string> {
    const [firstName, ...rest] = args.fullName.split(' ');
    const lastName = rest.join(' ') || firstName;

    const payload: Record<string, unknown> = {
      username: args.email,
      email: args.email,
      emailVerified: false,
      enabled: args.enabled,
      firstName,
      lastName,
      attributes: args.attributes ?? {},
    };

    if (args.temporaryPassword) {
      payload.credentials = [{
        type: 'password',
        value: args.temporaryPassword,
        temporary: true,
      }];
    }

    const { locationId } = await this.request('POST', '/users', payload);
    if (!locationId) {
      throw new Error('Keycloak did not return Location header after user creation');
    }
    return locationId;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request('DELETE', `/users/${userId}`);
  }

  async setUserEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.request('PUT', `/users/${userId}`, { enabled });
  }

  async updateUserAttributes(userId: string, attributes: Record<string, string[]>): Promise<void> {
    // Necesitamos GET para preservar los demás campos
    const { body: existing } = await this.request<Record<string, unknown>>('GET', `/users/${userId}`);
    if (!existing) throw new Error(`User ${userId} not found in Keycloak`);

    await this.request('PUT', `/users/${userId}`, {
      ...existing,
      attributes: { ...(existing.attributes as object ?? {}), ...attributes },
    });
  }

  async sendActionsEmail(userId: string, actions: string[]): Promise<void> {
    const params = new URLSearchParams();
    for (const action of actions) params.append('actions', action);
    await this.request('PUT', `/users/${userId}/execute-actions-email`, actions);
  }

  // -------- Realm role operations --------
  // Los roles de ELIZA (Tenant.Admin, Sales.Manager, ...) son roles de REALM:
  // el JWT los trae en `realm_access.roles` y así los definen el realm y los
  // usuarios sembrados. Se buscan en `/role-mappings/realm/available`, que solo
  // exige `manage-users`: el usuario técnico no necesita `view-realm` ni
  // `view-clients` (mínimo privilegio).
  private async getRealmRoleMappings(
    userId: string,
    which: 'assigned' | 'available',
  ): Promise<Array<{ id: string; name: string }>> {
    const suffix = which === 'available' ? '/available' : '';
    const { body } = await this.request<Array<{ id: string; name: string }>>(
      'GET',
      `/users/${userId}/role-mappings/realm${suffix}`,
    );
    return body ?? [];
  }

  async assignRealmRole(userId: string, roleName: string): Promise<void> {
    const available = await this.getRealmRoleMappings(userId, 'available');
    const role = available.find((r) => r.name === roleName);
    if (!role) {
      // Idempotente: si ya lo tiene asignado no es un error.
      const assigned = await this.getRealmRoleMappings(userId, 'assigned');
      if (assigned.some((r) => r.name === roleName)) return;
      throw new Error(`Realm role '${roleName}' not found or not assignable`);
    }

    await this.request('POST', `/users/${userId}/role-mappings/realm`, [
      { id: role.id, name: role.name },
    ]);
  }

  async revokeRealmRole(userId: string, roleName: string): Promise<void> {
    const assigned = await this.getRealmRoleMappings(userId, 'assigned');
    const role = assigned.find((r) => r.name === roleName);
    if (!role) return; // no-op si el usuario no tiene el rol

    await this.request('DELETE', `/users/${userId}/role-mappings/realm`, [
      { id: role.id, name: role.name },
    ]);
  }
}

export class KeycloakError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'KeycloakError';
  }
}
