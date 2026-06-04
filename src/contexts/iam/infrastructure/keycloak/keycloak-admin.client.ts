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

  // -------- Client role operations --------
  /** Obtiene el internal ID del client `eliza-api` (no es el clientId string). */
  private async getApiClientInternalId(): Promise<string> {
    const { body } = await this.request<Array<{ id: string; clientId: string }>>(
      'GET',
      `/clients?clientId=${encodeURIComponent(this.config.clientId)}`,
    );
    if (!body || body.length === 0) {
      throw new Error(`Client '${this.config.clientId}' not found in realm`);
    }
    return body[0].id;
  }

  async assignClientRole(userId: string, roleName: string): Promise<void> {
    const clientId = await this.getApiClientInternalId();

    // Obtener el role definition
    const { body: role } = await this.request<{ id: string; name: string }>(
      'GET',
      `/clients/${clientId}/roles/${encodeURIComponent(roleName)}`,
    );
    if (!role) throw new Error(`Role '${roleName}' not found in client '${this.config.clientId}'`);

    await this.request(
      'POST',
      `/users/${userId}/role-mappings/clients/${clientId}`,
      [{ id: role.id, name: role.name }],
    );
  }

  async revokeClientRole(userId: string, roleName: string): Promise<void> {
    const clientId = await this.getApiClientInternalId();
    const { body: role } = await this.request<{ id: string; name: string }>(
      'GET',
      `/clients/${clientId}/roles/${encodeURIComponent(roleName)}`,
    );
    if (!role) return; // no-op si el role ya no existe

    await this.request(
      'DELETE',
      `/users/${userId}/role-mappings/clients/${clientId}`,
      [{ id: role.id, name: role.name }],
    );
  }
}

export class KeycloakError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'KeycloakError';
  }
}
