#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * gen-test-jwt.ts — genera un JWT firmado RS256 + un JWKS local para
 * que el JwtAuthGuard del Sprint 2 lo valide criptográficamente sin
 * necesidad de un Keycloak completamente configurado.
 *
 * Flujo:
 *   1. Si no existe `.dev-keys/`, genera un keypair RSA 2048 + jwks.json
 *   2. Firma un JWT con los claims que ELIZA espera
 *   3. Imprime el token + instrucciones para usar el JWKS local
 *
 * USO:
 *   pnpm ts-node scripts/gen-test-jwt.ts --roles Platform.Admin
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ulid } from 'ulid';

interface Args {
  tenant: string;
  user: string;
  email: string;
  roles: string[];
  ttlSeconds: number;
  issuer: string;
  audience: string;
}

const KEY_DIR = path.join(process.cwd(), '.dev-keys');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'public.pem');
const JWKS_PATH = path.join(KEY_DIR, 'jwks.json');
const KID = 'eliza-dev-key-1';

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key && value !== undefined) args.set(key, value);
  }
  return {
    tenant: args.get('tenant') ?? '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    user: args.get('user') ?? '00000000-0000-0000-0000-000000000001',
    email: args.get('email') ?? 'santo@eliza.test',
    roles: (args.get('roles') ?? 'Platform.Admin').split(',').map((r) => r.trim()),
    ttlSeconds: Number(args.get('ttl') ?? 3600),
    issuer: args.get('issuer') ?? process.env.KEYCLOAK_ISSUER ?? 'http://eliza.test/realms/eliza',
    audience: args.get('audience') ?? process.env.KEYCLOAK_AUDIENCE ?? 'eliza-api',
  };
}

function ensureKeypair(): crypto.KeyObject {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true });

  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.log('🔑 Generating new RSA 2048 keypair for local testing...');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey.export({ type: 'spki', format: 'pem' }) as string);

    const jwk = publicKey.export({ format: 'jwk' });
    fs.writeFileSync(JWKS_PATH, JSON.stringify({
      keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
    }, null, 2));
    console.log(`   Saved to ${KEY_DIR}`);
  }
  return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH));
}

function b64url(input: object | string | Buffer): string {
  if (Buffer.isBuffer(input)) return input.toString('base64url');
  const json = typeof input === 'string' ? input : JSON.stringify(input);
  return Buffer.from(json, 'utf8').toString('base64url');
}

function signJwt(args: Args, privateKey: crypto.KeyObject): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const payload = {
    iss: args.issuer,
    aud: args.audience,
    sub: args.user,
    iat: now,
    exp: now + args.ttlSeconds,
    jti: ulid(),
    email: args.email,
    email_verified: true,
    preferred_username: args.email,
    name: 'Santo Tester',
    tenant_id: args.tenant,
    realm_access: { roles: args.roles },
    resource_access: { 'eliza-api': { roles: args.roles } },
    plant_id: 'plant-001',
    warehouse_id: 'wh-001',
  };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const privateKey = ensureKeypair();
  const token = signJwt(args, privateKey);

  console.log('\n=== ELIZA Test JWT (RS256, signed) ===');
  console.log(`tenant_id: ${args.tenant}`);
  console.log(`sub:       ${args.user}`);
  console.log(`email:     ${args.email}`);
  console.log(`roles:     ${args.roles.join(', ')}`);
  console.log(`issuer:    ${args.issuer}`);
  console.log(`audience:  ${args.audience}`);
  console.log(`expires:   ${new Date((Math.floor(Date.now() / 1000) + args.ttlSeconds) * 1000).toISOString()}`);
  console.log('\n--- Bearer token ---');
  console.log(token);
  console.log('\n--- For curl ---');
  console.log(`export ELIZA_TOKEN="${token}"`);
  console.log('\nPara que JwtAuthGuard valide este token:');
  console.log('  pnpm ts-node scripts/jwks-server.ts   (sirve el JWKS local en :9999)');
  console.log(`En .env:`);
  console.log(`  KEYCLOAK_JWKS_URI=http://localhost:9999/.well-known/jwks.json`);
  console.log(`  KEYCLOAK_ISSUER=${args.issuer}`);
  console.log(`  KEYCLOAK_AUDIENCE=${args.audience}\n`);
}

main();
