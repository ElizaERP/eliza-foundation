import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

/**
 * Marcadores temporales de autorización para el Sprint 1.
 *
 * En Sprint 2, el AuthGuard real (jwks-rsa + passport-jwt) leerá estos
 * metadata y enforce el RBAC contra los claims del JWT firmado por
 * Keycloak. Hoy son no-op a nivel de seguridad — pero documentan la
 * intención y se renderizan en Swagger.
 *
 * Convención de roles (alineada con el Doc 11 — Seguridad):
 *   Platform.Admin   → operador SaaS de ELIZA (no es de ningún tenant)
 *   Tenant.Admin     → administrador del propio tenant
 *   <Module>.Manager → gerente de módulo (Manufacturing, Sales, etc.)
 *   <Module>.Operator → operario de módulo
 */

export const ROLES_KEY = 'auth:requiredRoles';

export function RequireRoles(...roles: string[]) {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiSecurity('bearer', roles),
  );
}

/**
 * Marca una ruta como pública (no requiere autenticación).
 * El AuthGuard del Sprint 2 saltará la validación cuando vea este flag.
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
