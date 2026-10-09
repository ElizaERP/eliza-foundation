import { Body, Controller, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';

import { SkipAudit } from '../../../audit/infrastructure/interceptors/audit.interceptor';
import { Login, Logout, RefreshSession } from '../../application';
import { SessionTokens } from '../../domain';
import { AuthThrottlerGuard } from '../../infrastructure/auth/auth-throttler.guard';
import { LoginRequest, RefreshSessionRequest, SessionResponse } from './dto/session.dto';
import { toAppErrorOrThrow } from './result-utils';

const toResponse = (t: SessionTokens): SessionResponse => ({ ...t, tokenType: 'Bearer' });

/**
 * Sesión de la app móvil sin navegador.
 *
 * - @Public(): son las rutas que se usan ANTES de tener un token.
 * - @SkipAudit(): el cuerpo lleva contraseñas y refresh tokens; no se guarda.
 * - Cache-Control: no-store en las respuestas con tokens (RFC 6749 §5.1).
 * - Límite de intentos por IP + usuario (AuthThrottlerGuard) además del
 *   bloqueo temporal de Keycloak tras 5 contraseñas incorrectas.
 */
@ApiTags('IAM · Sesión')
@Public()
@SkipAudit()
@UseGuards(AuthThrottlerGuard)
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly loginUseCase: Login,
    private readonly refreshUseCase: RefreshSession,
    private readonly logoutUseCase: Logout,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Iniciar sesión con usuario y contraseña' })
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'auth.invalid_credentials' })
  @ApiTooManyRequestsResponse({ description: 'Más de 10 intentos por minuto para el mismo usuario' })
  async login(@Body() body: LoginRequest): Promise<SessionResponse> {
    const r = await this.loginUseCase.execute({ username: body.username, password: body.password });
    return toResponse(toAppErrorOrThrow(r));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renovar los tokens con el refresh token' })
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'auth.session_expired' })
  async refresh(@Body() body: RefreshSessionRequest): Promise<SessionResponse> {
    const r = await this.refreshUseCase.execute({ refreshToken: body.refreshToken });
    return toResponse(toAppErrorOrThrow(r));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cerrar la sesión (revoca el refresh token en Keycloak)' })
  @ApiNoContentResponse()
  async logout(@Body() body: RefreshSessionRequest): Promise<void> {
    toAppErrorOrThrow(await this.logoutUseCase.execute({ refreshToken: body.refreshToken }));
  }
}
