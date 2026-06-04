import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { KeycloakConfig } from '../keycloak/keycloak.config';
import { JwksService } from './jwks.service';

/**
 * Payload tipado del JWT que emite Keycloak para ELIZA.
 *
 * Los claims `tenant_id`, `plant_id`, `warehouse_id` los inyecta Keycloak
 * vía un token mapper definido en la configuración del realm (ver
 * /keycloak/realm/eliza-realm.json).
 */
export interface ElizaJwtPayload {
  sub: string;
  email: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  jti?: string;

  // Custom claims de ELIZA
  tenant_id?: string;
  plant_id?: string;
  warehouse_id?: string;

  // Roles Keycloak
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Estructura que se adjunta a `request.user` tras la validación.
 * Lo usan los controllers vía @CurrentUser().
 */
export interface AuthenticatedUser {
  keycloakSubject: string;
  email: string;
  tenantId: string | null;
  plantId: string | null;
  warehouseId: string | null;
  roles: string[];
  raw: ElizaJwtPayload;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'eliza-jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly jwks: JwksService,
    private readonly config: KeycloakConfig,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: [config.jwtAlgorithm],
      issuer: config.issuer,
      audience: config.audience,
      // secretOrKeyProvider resuelve la clave por cada token usando el kid
      secretOrKeyProvider: async (
        _req: unknown,
        rawJwtToken: string,
        done: (err: Error | null, key?: string) => void,
      ) => {
        try {
          const header = this.decodeHeader(rawJwtToken);
          if (!header.kid) {
            return done(new Error('JWT header missing kid'));
          }
          const key = await this.jwks.getSigningKey(header.kid);
          if (!key) return done(new Error(`Unknown kid: ${header.kid}`));
          done(null, key);
        } catch (e) {
          done(e as Error);
        }
      },
    });
  }

  /**
   * Se invoca con el payload YA validado criptográficamente.
   * Aquí construimos el AuthenticatedUser que se adjuntará a `request.user`.
   */
  validate(payload: ElizaJwtPayload): AuthenticatedUser {
    if (!payload.sub) {
      throw new UnauthorizedException('JWT is missing required claim: sub');
    }

    const realmRoles = payload.realm_access?.roles ?? [];
    const apiClientRoles =
      payload.resource_access?.[this.config.clientId]?.roles ?? [];

    // Unión sin duplicados
    const roles = Array.from(new Set([...realmRoles, ...apiClientRoles]));

    return {
      keycloakSubject: payload.sub,
      email: payload.email,
      tenantId: payload.tenant_id ?? null,
      plantId: payload.plant_id ?? null,
      warehouseId: payload.warehouse_id ?? null,
      roles,
      raw: payload,
    };
  }

  private decodeHeader(token: string): { kid?: string; alg?: string; typ?: string } {
    const [headerB64] = token.split('.');
    if (!headerB64) throw new Error('Malformed JWT');
    return JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  }
}
