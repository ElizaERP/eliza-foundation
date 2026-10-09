import { Inject, Injectable } from '@nestjs/common';

import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  SESSION_PROVIDER_PORT,
  SessionFailure,
  SessionProviderPort,
  SessionTokens,
} from '../../domain';

/**
 * Login de la app sin navegador: la app envía usuario y contraseña a la API,
 * y la API obtiene los tokens de Keycloak por la red interna.
 *
 * Los códigos de error son estables (la app decide qué mostrar con ellos);
 * los mensajes ya vienen en español para el usuario final.
 */
export function sessionError(failure: SessionFailure): ApplicationError {
  switch (failure) {
    case 'invalid_credentials':
      return applicationError(
        'auth.invalid_credentials',
        'Usuario o contraseña incorrectos.',
        'unauthorized',
      );
    case 'account_setup_required':
      return applicationError(
        'auth.account_setup_required',
        'Tu cuenta tiene un paso pendiente (por ejemplo, cambiar la contraseña temporal). Pide ayuda al administrador.',
        'forbidden',
      );
    case 'session_expired':
      return applicationError(
        'auth.session_expired',
        'Tu sesión venció. Vuelve a iniciar sesión.',
        'unauthorized',
      );
    case 'provider_unavailable':
    default:
      return applicationError(
        'auth.provider_unavailable',
        'El inicio de sesión no está disponible en este momento. Intenta de nuevo en unos minutos.',
        'infrastructure',
      );
  }
}

const toResult = (r: Result<SessionTokens, SessionFailure>): Result<SessionTokens, ApplicationError> =>
  r.isOk ? ok(r.value) : err(sessionError(r.error));

// =====================================================================
// Login
// =====================================================================
export interface LoginInput {
  username: string;
  password: string;
}

@Injectable()
export class Login implements UseCase<LoginInput, SessionTokens> {
  constructor(@Inject(SESSION_PROVIDER_PORT) private readonly sessions: SessionProviderPort) {}

  async execute(input: LoginInput): Promise<Result<SessionTokens, ApplicationError>> {
    return toResult(await this.sessions.login(input.username.trim(), input.password));
  }
}

// =====================================================================
// RefreshSession
// =====================================================================
export interface RefreshSessionInput {
  refreshToken: string;
}

@Injectable()
export class RefreshSession implements UseCase<RefreshSessionInput, SessionTokens> {
  constructor(@Inject(SESSION_PROVIDER_PORT) private readonly sessions: SessionProviderPort) {}

  async execute(input: RefreshSessionInput): Promise<Result<SessionTokens, ApplicationError>> {
    return toResult(await this.sessions.refresh(input.refreshToken));
  }
}

// =====================================================================
// Logout
// =====================================================================
export interface LogoutInput {
  refreshToken: string;
}

@Injectable()
export class Logout implements UseCase<LogoutInput, void> {
  constructor(@Inject(SESSION_PROVIDER_PORT) private readonly sessions: SessionProviderPort) {}

  /** Siempre OK: si Keycloak no responde, la app igual borra la sesión local. */
  async execute(input: LogoutInput): Promise<Result<void, ApplicationError>> {
    await this.sessions.logout(input.refreshToken);
    return ok(undefined);
  }
}
