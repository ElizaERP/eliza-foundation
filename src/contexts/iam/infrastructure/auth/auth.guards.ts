import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';

import {
  CLS_TENANT_ID,
  CLS_USER_ID,
  CLS_USER_ROLES,
} from '@eliza/shared-kernel/infrastructure/tenant-context/tenant-context.service';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';

import { AuthenticatedUser } from './jwt.strategy';

/**
 * JwtAuthGuard — extiende AuthGuard('eliza-jwt') con dos extras:
 *   1. Respeta @Public() — rutas públicas saltan validación
 *   2. Sobreescribe el CLS context con los valores VERIFICADOS del JWT.
 *      Esto reemplaza los valores no-verificados que puso el
 *      TenantContextMiddleware en Sprint 0/1.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('eliza-jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const result = (await super.canActivate(context)) as boolean;
    if (!result) return false;

    // Re-popular CLS con valores VERIFICADOS
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (req.user) {
      this.cls.set(CLS_USER_ID, req.user.keycloakSubject);
      this.cls.set(CLS_USER_ROLES, req.user.roles);
      if (req.user.tenantId) {
        this.cls.set(CLS_TENANT_ID, req.user.tenantId);
      }
    }
    return true;
  }

  override handleRequest<T = AuthenticatedUser>(
    err: Error | null,
    user: T | false,
    info: { name?: string; message?: string } | undefined,
  ): T {
    if (err || !user) {
      const reason = err?.message ?? info?.message ?? 'invalid token';
      this.logger.debug(`Auth rejected: ${reason}`);
      throw new UnauthorizedException(`Authentication failed: ${reason}`);
    }
    return user;
  }
}

/**
 * RolesGuard — lee el metadata @RequireRoles() y compara contra los
 * roles del JWT validado. Permite OR semantics: si la lista contiene
 * `[A, B]`, el usuario debe tener A O B (no ambas).
 *
 * Para reglas más complejas (AND, expresiones), usar AbacGuard con
 * policies declarativas en Sprint 3 / iteración futura.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('No authenticated user in request');
    }

    const hasAny = required.some((role) => user.roles.includes(role));
    if (!hasAny) {
      this.logger.debug(
        `Forbidden: user ${user.keycloakSubject} has roles [${user.roles.join(', ')}] but needs one of [${required.join(', ')}]`,
      );
      throw new ForbiddenException(
        `This action requires one of the following roles: ${required.join(', ')}`,
      );
    }

    return true;
  }
}

/**
 * @CurrentUser() — inyecta el AuthenticatedUser en el handler.
 *
 * Uso:
 *   async miEndpoint(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * Si una propiedad específica es lo único necesario:
 *   async miEndpoint(@CurrentUser('tenantId') tenantId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
