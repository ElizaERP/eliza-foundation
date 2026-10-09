import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Límite de intentos para las rutas públicas de sesión (/v1/auth/*).
 *
 * La clave combina IP + usuario: así un usuario que se equivoca no bloquea
 * a los demás. Hoy todas las peticiones llegan con la IP del proxy (Nginx),
 * por eso el usuario es la parte que distingue; cuando la API confíe en
 * X-Forwarded-For (paso de endurecimiento), la IP también contará.
 *
 * Además del límite de la API, Keycloak bloquea temporalmente al usuario
 * después de 5 contraseñas incorrectas (protección contra fuerza bruta).
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- firma de ThrottlerGuard
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = req.ip ?? 'sin-ip';
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    return username ? `${ip}|${username}` : ip;
  }
}
