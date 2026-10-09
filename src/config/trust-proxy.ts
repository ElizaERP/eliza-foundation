/**
 * Proxies en los que la API confía para leer la IP real del cliente
 * desde X-Forwarded-For (sintaxis de Express 'trust proxy').
 *
 * En DEV la cadena es: cliente → Tailscale (Serve/Funnel) → Nginx (red de
 * Docker, 172.16/12) → API. Solo se confía en saltos de red privada, así que
 * una IP pública que el cliente invente en la cabecera nunca se toma como suya.
 */
export const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';
