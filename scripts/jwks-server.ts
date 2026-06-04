#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * jwks-server.ts — servidor HTTP mínimo que expone el JWKS generado
 * por gen-test-jwt.ts en `http://localhost:9999/.well-known/jwks.json`.
 *
 * Permite que el JwtAuthGuard valide tokens firmados localmente sin
 * necesidad de Keycloak corriendo. Solo para desarrollo/testing.
 *
 * USO:
 *   pnpm ts-node scripts/jwks-server.ts
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

const PORT = Number(process.env.JWKS_PORT ?? 9999);
const JWKS_PATH = path.join(process.cwd(), '.dev-keys', 'jwks.json');

if (!fs.existsSync(JWKS_PATH)) {
  console.error(`❌ JWKS not found at ${JWKS_PATH}`);
  console.error(`   Run: pnpm ts-node scripts/gen-test-jwt.ts (to generate)`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url === '/.well-known/jwks.json' || req.url === '/jwks.json') {
    const jwks = fs.readFileSync(JWKS_PATH, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(jwks);
    console.log(`✓ Served JWKS to ${req.headers['user-agent']?.slice(0, 40) ?? 'unknown'}`);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found. Try /.well-known/jwks.json');
});

server.listen(PORT, () => {
  console.log(`🔑 Local JWKS server listening on http://localhost:${PORT}`);
  console.log(`   Endpoint: http://localhost:${PORT}/.well-known/jwks.json`);
  console.log(`   Configure in .env: KEYCLOAK_JWKS_URI=http://localhost:${PORT}/.well-known/jwks.json`);
  console.log(`   Press Ctrl+C to stop.`);
});
