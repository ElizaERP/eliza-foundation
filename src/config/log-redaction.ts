/**
 * Qué se oculta en los logs JSON de la API (pino `redact`).
 *
 * Tailscale Serve agrega a cada request que llega desde la tailnet la
 * identidad de quien lo hace: correo (`Tailscale-User-Login`), nombre
 * (`Tailscale-User-Name`) y URL de la foto (`Tailscale-User-Profile-Pic`).
 * pino-http registra todas las cabeceras del request, así que esos datos
 * personales quedaban en cada línea de log, tanto en respuestas correctas
 * como en errores (hallazgo crítico "Logs" de la Fase 0).
 *
 * La lista se aplica a todo objeto `req` que se registre, sea en el log de
 * acceso o en el de error. Se reemplaza el valor (no se borra la clave) para
 * que se vea que la cabecera llegó sin exponer su contenido.
 */
export const LOG_REDACT_CENSOR = '[REDACTED]';

export const LOG_REDACT_PATHS: string[] = [
  // Credenciales
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.client_secret',
  '*.refreshToken',
  '*.refresh_token',
  '*.accessToken',
  '*.access_token',
  '*.creditCard',
  // Identidad que agrega Tailscale Serve
  'req.headers["tailscale-user-login"]',
  'req.headers["tailscale-user-name"]',
  'req.headers["tailscale-user-profile-pic"]',
  'req.headers["tailscale-headers-info"]',
];
