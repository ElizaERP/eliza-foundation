import { Injectable, Logger } from '@nestjs/common';
import { JwksClient } from 'jwks-rsa';

import { KeycloakConfig } from '../keycloak/keycloak.config';

/**
 * JwksService — wrapper sobre `jwks-rsa` que obtiene las claves
 * públicas (JWKS) del realm de Keycloak y las cachea con rotación.
 *
 * El JwtStrategy lo consulta por cada token entrante usando el `kid`
 * del header del JWT. La caché:
 *   - TTL configurable (default 10 min)
 *   - Rate limiting: máx 5 fetches por minuto si la key no está en caché
 *
 * En producción, las claves rotan periódicamente sin tirar la app:
 * cuando llega un token firmado con una key nueva, jwks-rsa hace un
 * single fetch y todos los requests siguientes usan la versión cacheada.
 */
@Injectable()
export class JwksService {
  private readonly logger = new Logger(JwksService.name);
  private readonly client: JwksClient;

  constructor(private readonly config: KeycloakConfig) {
    this.client = new JwksClient({
      jwksUri: config.jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: config.jwksCacheMaxAgeMs,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 5000,
    });
    this.logger.log(`JWKS configured: ${config.jwksUri}`);
  }

  /** Devuelve la clave pública correspondiente al kid o null si no existe. */
  async getSigningKey(kid: string): Promise<string | null> {
    try {
      const key = await this.client.getSigningKey(kid);
      return key.getPublicKey();
    } catch (e) {
      this.logger.warn(`Failed to resolve JWKS kid=${kid}: ${(e as Error).message}`);
      return null;
    }
  }
}
