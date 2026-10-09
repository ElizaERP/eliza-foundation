import { Result } from '@eliza/shared-kernel/domain';

/**
 * SessionProviderPort — inicio de sesión con usuario y contraseña desde la
 * app, sin abrir el navegador.
 *
 * La API habla con el proveedor de identidad (Keycloak) por la red interna:
 * el teléfono nunca conoce el secreto del cliente ni la URL de Keycloak.
 * Los tokens que devuelve son los mismos JWT que ya valida el JwtAuthGuard.
 */
export interface SessionProviderPort {
  /** Usuario y contraseña → tokens. */
  login(username: string, password: string): Promise<Result<SessionTokens, SessionFailure>>;

  /** Refresh token → tokens nuevos (Keycloak puede rotar el refresh token). */
  refresh(refreshToken: string): Promise<Result<SessionTokens, SessionFailure>>;

  /** Cierra la sesión en el proveedor. Nunca falla hacia el cliente. */
  logout(refreshToken: string): Promise<void>;
}

export interface SessionTokens {
  accessToken: string;
  /** Segundos hasta que vence el access token. */
  expiresIn: number;
  refreshToken: string;
  /** Segundos hasta que vence el refresh token (inactividad de la sesión). */
  refreshExpiresIn: number;
}

/**
 * Motivos esperables de fallo. Se nombran por lo que significan para el
 * usuario, no por el error técnico del proveedor:
 *  - invalid_credentials: usuario o contraseña incorrectos, cuenta deshabilitada
 *    o bloqueada temporalmente (no se distinguen, para no revelar qué usuarios existen).
 *  - account_setup_required: credenciales correctas, pero el usuario tiene acciones
 *    pendientes (por ejemplo, cambiar una contraseña temporal).
 *  - session_expired: el refresh token venció o fue revocado.
 *  - provider_unavailable: Keycloak no responde, o el login de la app no está configurado.
 */
export type SessionFailure =
  | 'invalid_credentials'
  | 'account_setup_required'
  | 'session_expired'
  | 'provider_unavailable';

export const SESSION_PROVIDER_PORT = Symbol('SessionProviderPort');
