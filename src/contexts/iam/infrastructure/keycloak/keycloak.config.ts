import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * KeycloakConfig — configuración inmutable derivada de variables de
 * entorno. Centralizada para que el rest del código no toque
 * ConfigService directamente.
 */
@Injectable()
export class KeycloakConfig {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly jwksUri: string;
  readonly issuer: string;
  readonly audience: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
  readonly jwtAlgorithm: 'RS256' | 'RS384' | 'RS512';
  readonly jwksCacheMaxAgeMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('KEYCLOAK_BASE_URL');
    this.realm = config.getOrThrow<string>('KEYCLOAK_REALM');
    this.clientId = config.getOrThrow<string>('KEYCLOAK_CLIENT_ID');
    this.clientSecret = config.getOrThrow<string>('KEYCLOAK_CLIENT_SECRET');
    this.jwksUri = config.getOrThrow<string>('KEYCLOAK_JWKS_URI');
    this.issuer = config.getOrThrow<string>('KEYCLOAK_ISSUER');
    this.audience = config.getOrThrow<string>('KEYCLOAK_AUDIENCE');
    this.adminUsername = config.get<string>('KEYCLOAK_ADMIN_USERNAME', 'admin');
    this.adminPassword = config.get<string>('KEYCLOAK_ADMIN_PASSWORD', 'admin');
    this.jwtAlgorithm = config.get<'RS256' | 'RS384' | 'RS512'>('JWT_ALGORITHM', 'RS256');
    this.jwksCacheMaxAgeMs = Number(config.get<number>('JWT_CACHE_MAX_AGE_MS', 600_000));
  }

  /** URL del endpoint del realm: <base>/admin/realms/<realm> */
  get adminRealmUrl(): string {
    return `${this.baseUrl}/admin/realms/${this.realm}`;
  }

  /** Endpoint del token (master realm) para obtener admin token. */
  get tokenUrl(): string {
    return `${this.baseUrl}/realms/master/protocol/openid-connect/token`;
  }
}
