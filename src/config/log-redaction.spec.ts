import { Writable } from 'node:stream';

import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import request from 'supertest';

import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from './log-redaction';

/**
 * Los logs de acceso y de error de pino-http, con la misma lista de `redact`
 * que usa la API, no deben contener la identidad que agrega Tailscale Serve
 * ni credenciales.
 */
describe('logs: datos sensibles ocultos', () => {
  const lineas: string[] = [];
  const destino = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lineas.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      cb();
    },
  });
  const app = express();
  app.use(
    pinoHttp({
      logger: pino({ redact: { paths: LOG_REDACT_PATHS, censor: LOG_REDACT_CENSOR } }, destino),
    }),
  );
  app.get('/ok', (_req, res) => res.json({ ok: true }));
  app.get('/falla', (_req, res) => res.status(500).json({ error: 'x' }));

  const IDENTIDAD = {
    'Tailscale-User-Login': 'persona@ejemplo.com',
    'Tailscale-User-Name': 'Persona Ejemplo',
    'Tailscale-User-Profile-Pic': 'https://ejemplo.com/foto.png',
    'Tailscale-Headers-Info': 'https://tailscale.com/s/serve-headers',
    Authorization: 'Bearer token-secreto',
    Cookie: 'sesion=secreta',
  };

  const ultimaLinea = async (ruta: string) => {
    lineas.length = 0;
    await request(app).get(ruta).set(IDENTIDAD);
    const linea = lineas.at(-1);
    if (!linea) throw new Error('pino no escribió nada');
    return { texto: linea, json: JSON.parse(linea) as { req: { headers: Record<string, string> } } };
  };

  it.each(['/ok', '/falla'])('%s: ninguna cabecera sensible aparece en el log', async (ruta) => {
    const { texto, json } = await ultimaLinea(ruta);
    for (const valor of Object.values(IDENTIDAD)) expect(texto).not.toContain(valor);
    for (const cabecera of Object.keys(IDENTIDAD)) {
      expect(json.req.headers[cabecera.toLowerCase()]).toBe(LOG_REDACT_CENSOR);
    }
  });

  it('las demás cabeceras se siguen registrando', async () => {
    const { json } = await ultimaLinea('/ok');
    expect(json.req.headers.host).toMatch(/127\.0\.0\.1/);
  });
});
