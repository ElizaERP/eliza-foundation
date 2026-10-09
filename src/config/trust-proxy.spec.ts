import express from 'express';
import request from 'supertest';

import { DEFAULT_TRUST_PROXY } from './trust-proxy';

/**
 * req.ip con la configuración de 'trust proxy' de la API.
 * supertest conecta por loopback (127.0.0.1), que hace el papel del último
 * proxy (Nginx); lo que viene en X-Forwarded-For es lo que agregaron los saltos previos.
 */
describe('trust proxy (IP real del cliente)', () => {
  const app = express();
  app.set('trust proxy', DEFAULT_TRUST_PROXY);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const ipWith = async (xff?: string) => {
    const r = request(app).get('/ip');
    if (xff) r.set('X-Forwarded-For', xff);
    return (await r).body.ip as string;
  };

  it('Funnel → Nginx público: la IP pública del cliente', async () => {
    expect(await ipWith('181.50.10.20')).toBe('181.50.10.20');
  });

  it('una IP inventada por el cliente a la izquierda se ignora', async () => {
    expect(await ipWith('1.2.3.4, 181.50.10.20')).toBe('181.50.10.20');
  });

  it('tailnet: Tailscale Serve → Nginx (gateway de Docker) → API: la IP del equipo en la tailnet', async () => {
    expect(await ipWith('100.104.17.3, 172.18.0.1')).toBe('100.104.17.3');
  });

  it('sin cabecera: la IP de la conexión', async () => {
    expect(await ipWith()).toMatch(/127\.0\.0\.1$/);
  });
});
