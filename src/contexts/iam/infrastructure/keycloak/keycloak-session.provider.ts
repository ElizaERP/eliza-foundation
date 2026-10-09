import { Injectable, Logger } from '@nestjs/common';

import { Result, err, ok } from '@eliza/shared-kernel/domain';

import { SessionFailure, SessionProviderPort, SessionTokens } from '../../domain';
import { KeycloakConfig } from './keycloak.config';

interface KeycloakTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Implementación del SessionProviderPort sobre el endpoint OIDC de Keycloak,
 * con el cliente confidencial eliza-app-login (solo login directo).
 *
 * - Habla con Keycloak por la red interna (KEYCLOAK_BASE_URL). El emisor de los
 *   tokens sigue siendo KC_HOSTNAME, así que el JwtAuthGuard los acepta igual.
 * - Nunca registra contraseñas, tokens ni el secreto del cliente.
 * - Sin traducción de negocio: solo convierte respuestas de Keycloak en SessionFailure.
 */
@Injectable()
export class KeycloakSessionProvider implements SessionProviderPort {
  private static readonly TIMEOUT_MS = 8_000;
  private readonly logger = new Logger(KeycloakSessionProvider.name);

  constructor(private readonly config: KeycloakConfig) {}

  async login(username: string, password: string): Promise<Result<SessionTokens, SessionFailure>> {
    return this.token({ grant_type: 'password', username, password }, 'login');
  }

  async refresh(refreshToken: string): Promise<Result<SessionTokens, SessionFailure>> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh');
  }

  async logout(refreshToken: string): Promise<void> {
    const creds = this.credentials();
    if (!creds) return;
    try {
      const res = await this.post(this.config.realmLogoutUrl, { ...creds, refresh_token: refreshToken });
      // 400 = el refresh token ya no es válido: la sesión ya estaba cerrada.
      if (!res.ok && res.status !== 400) {
        this.logger.warn(`Keycloak logout respondió ${res.status}`);
      }
    } catch (e) {
      this.logger.warn(`Keycloak logout no respondió: ${(e as Error).message}`);
    }
  }

  // -------- Internos --------

  private credentials(): { client_id: string; client_secret: string } | null {
    const { loginClientId, loginClientSecret } = this.config;
    if (!loginClientId || !loginClientSecret) return null;
    return { client_id: loginClientId, client_secret: loginClientSecret };
  }

  private async token(
    params: Record<string, string>,
    kind: 'login' | 'refresh',
  ): Promise<Result<SessionTokens, SessionFailure>> {
    const creds = this.credentials();
    if (!creds) {
      this.logger.error('Login de la app sin configurar: faltan KEYCLOAK_LOGIN_CLIENT_ID / KEYCLOAK_LOGIN_CLIENT_SECRET');
      return err('provider_unavailable');
    }

    let res: Response;
    let body: KeycloakTokenResponse;
    try {
      res = await this.post(this.config.realmTokenUrl, { ...creds, ...params });
      body = (await res.json().catch(() => ({}))) as KeycloakTokenResponse;
    } catch (e) {
      this.logger.error(`Keycloak no respondió (${kind}): ${(e as Error).message}`);
      return err('provider_unavailable');
    }

    if (res.ok && body.access_token && body.refresh_token) {
      return ok({
        accessToken: body.access_token,
        expiresIn: Number(body.expires_in ?? 0),
        refreshToken: body.refresh_token,
        refreshExpiresIn: Number(body.refresh_expires_in ?? 0),
      });
    }

    if (body.error === 'invalid_grant') {
      if (kind === 'refresh') return err('session_expired');
      // Keycloak responde "Account is not fully set up" solo con la contraseña correcta.
      if ((body.error_description ?? '').toLowerCase().includes('not fully set up')) {
        return err('account_setup_required');
      }
      return err('invalid_credentials');
    }

    // invalid_client / unauthorized_client = el cliente o su secreto están mal: es configuración, no del usuario.
    this.logger.error(`Keycloak rechazó el ${kind}: ${res.status} ${body.error ?? 'sin código'}`);
    return err('provider_unavailable');
  }

  private post(url: string, form: Record<string, string>): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(KeycloakSessionProvider.TIMEOUT_MS),
    });
  }
}
