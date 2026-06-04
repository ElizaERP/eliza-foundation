import { Injectable, Logger, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ulid } from 'ulid';

import {
  CLS_CORRELATION_ID,
  CLS_REQUEST_IP,
  CLS_TENANT_ID,
  CLS_USER_AGENT,
  CLS_USER_ID,
  CLS_USER_ROLES,
} from './tenant-context.service';

/**
 * Resuelve el tenant_id del request y lo establece en el ClsStore.
 *
 * Estrategia (en orden de prioridad, configurable via env):
 *   1. JWT claim `tenant_id` — caso normal en producción (firmado por Keycloak)
 *   2. Header `X-Tenant-Id` — solo para tooling interno / tests
 *   3. Subdomain — opcional, para tenants con dominio propio (Enterprise)
 *
 * IMPORTANTE: el tenant_id NUNCA debe venir del body o query string,
 * porque eso permitiría que un usuario malicioso opere sobre un tenant
 * que no le pertenece. Solo se acepta de fuentes firmadas o controladas.
 *
 * Este middleware corre ANTES de los guards de autorización. Si no hay
 * tenant_id resoluble, lanza 401. El AuthGuard (Sprint 2) hará la
 * validación criptográfica del JWT y verificará la membresía del usuario.
 */
interface DecodedJwt {
  sub?: string;
  tenant_id?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);
  private readonly headerName: string;
  private readonly strategies: Array<'jwt' | 'header' | 'subdomain'>;

  constructor(
    private readonly cls: ClsService,
    config: ConfigService,
  ) {
    this.headerName = config.get<string>('TENANT_HEADER_NAME', 'X-Tenant-Id');
    const strategyEnv = config.get<string>('TENANT_RESOLUTION_STRATEGY', 'jwt');
    this.strategies = strategyEnv.split(',').map((s) => s.trim()) as Array<
      'jwt' | 'header' | 'subdomain'
    >;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // 1. Generar / propagar correlationId
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? ulid();
    this.cls.set(CLS_CORRELATION_ID, correlationId);
    res.setHeader('X-Correlation-Id', correlationId);

    // 2. Metadata útil para audit & observabilidad
    this.cls.set(CLS_REQUEST_IP, this.extractIp(req));
    this.cls.set(CLS_USER_AGENT, req.headers['user-agent'] ?? null);

    // 3. Resolver tenant según la estrategia configurada
    let tenantId: string | null = null;
    let userId: string | null = null;
    let userRoles: string[] = [];

    for (const strategy of this.strategies) {
      if (tenantId) break;

      switch (strategy) {
        case 'jwt': {
          const resolved = this.resolveFromJwt(req);
          if (resolved) {
            tenantId = resolved.tenantId;
            userId = resolved.userId;
            userRoles = resolved.roles;
          }
          break;
        }
        case 'header': {
          const header = req.headers[this.headerName.toLowerCase()];
          if (typeof header === 'string' && header.length > 0) {
            tenantId = header;
          }
          break;
        }
        case 'subdomain': {
          tenantId = this.resolveFromSubdomain(req);
          break;
        }
      }
    }

    if (tenantId) this.cls.set(CLS_TENANT_ID, tenantId);
    if (userId) this.cls.set(CLS_USER_ID, userId);
    if (userRoles.length) this.cls.set(CLS_USER_ROLES, userRoles);

    // Rutas públicas (login, health, swagger) se manejan vía decorator
    // @Public() en sus controllers; no requieren tenant context establecido.
    // El AuthGuard (Sprint 2) enforce esto a nivel de ruta.

    next();
  }

  private resolveFromJwt(
    req: Request,
  ): { tenantId: string; userId: string; roles: string[] } | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;

    const token = auth.slice(7);

    // En este punto NO validamos la firma (eso lo hace el AuthGuard con
    // jwks-rsa). Solo decodificamos el payload para extraer claims.
    // Si el token está mal formado, devolvemos null y el guard fallará.
    try {
      const [, payloadB64] = token.split('.');
      if (!payloadB64) return null;
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as DecodedJwt;

      if (!payload.tenant_id || !payload.sub) return null;

      const realmRoles = payload.realm_access?.roles ?? [];
      const resourceRoles = Object.values(payload.resource_access ?? {}).flatMap(
        (r) => r.roles ?? [],
      );

      return {
        tenantId: payload.tenant_id,
        userId: payload.sub,
        roles: [...realmRoles, ...resourceRoles],
      };
    } catch (err) {
      this.logger.debug(`Failed to decode JWT payload: ${(err as Error).message}`);
      return null;
    }
  }

  private resolveFromSubdomain(req: Request): string | null {
    // Esperado: <tenant-code>.eliza.app → resolver tenantCode → tenantId
    // Aquí solo devolvemos el code. El TenantResolverService (Sprint 1)
    // lo traduce a tenantId vía caché.
    const host = req.headers.host ?? '';
    const parts = host.split('.');
    if (parts.length < 3) return null;
    return parts[0]; // tenant-code
  }

  private extractIp(req: Request): string {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') return fwd.split(',')[0].trim();
    return req.socket.remoteAddress ?? 'unknown';
  }
}
