import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ulid } from 'ulid';

import { TenantContextPort } from '../../application/ports';

/**
 * Claves usadas en el ClsStore para el request actual. Centralizadas
 * aquí para evitar typos.
 */
export const CLS_TENANT_ID = 'tenantId';
export const CLS_USER_ID = 'userId';
export const CLS_CORRELATION_ID = 'correlationId';
export const CLS_USER_ROLES = 'userRoles';
export const CLS_REQUEST_IP = 'requestIp';
export const CLS_USER_AGENT = 'userAgent';

/**
 * Implementación del TenantContextPort sobre nestjs-cls (AsyncLocalStorage).
 *
 * Cada request HTTP tiene su propio "store" que se propaga implícitamente
 * por toda la cadena de async/await sin necesidad de pasar el tenant
 * como parámetro en cada función.
 *
 * El TenantContextMiddleware popula este store al inicio de cada request
 * extrayendo el tenant_id del JWT (vía Keycloak). El PrismaService lo lee
 * para hacer SET LOCAL app.tenant_id en cada transacción.
 *
 * Seguridad: si una capa intenta leer el tenant_id sin que esté
 * establecido (ej: por error en el middleware), getTenantId() lanza
 * inmediatamente. Es preferible un 500 ruidoso a un data leak silencioso.
 */
@Injectable()
export class TenantContextService implements TenantContextPort {
  constructor(private readonly cls: ClsService) {}

  getTenantId(): string {
    const tenantId = this.cls.get<string | undefined>(CLS_TENANT_ID);
    if (!tenantId) {
      throw new Error(
        'TenantContext is not established. ' +
        'Did you forget to add TenantContextMiddleware to this route? ' +
        'No data operation is allowed without an explicit tenant context.',
      );
    }
    return tenantId;
  }

  tryGetTenantId(): string | null {
    return this.cls.get<string | undefined>(CLS_TENANT_ID) ?? null;
  }

  tryGetUserId(): string | null {
    return this.cls.get<string | undefined>(CLS_USER_ID) ?? null;
  }

  getCorrelationId(): string {
    let id = this.cls.get<string | undefined>(CLS_CORRELATION_ID);
    if (!id) {
      // Genera uno tardíamente si el middleware no lo estableció (ej: jobs).
      id = ulid();
      this.cls.set(CLS_CORRELATION_ID, id);
    }
    return id;
  }
}
