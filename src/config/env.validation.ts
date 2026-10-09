import Joi from 'joi';

import { DEFAULT_TRUST_PROXY } from './trust-proxy';

/**
 * Schema de validación para las variables de entorno.
 *
 * El boot falla en cuanto detecta una variable faltante o inválida,
 * en lugar de explotar tarde en runtime con un mensaje confuso.
 *
 * Cada BC adicional puede componer su propio schema y mergearlo.
 */
export const envValidationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  APP_NAME: Joi.string().default('eliza-foundation'),
  APP_PORT: Joi.number().port().default(3000),
  APP_GLOBAL_PREFIX: Joi.string().default('api'),
  APP_VERSION: Joi.string().default('v1'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
  // json = una linea JSON por evento (estructurado, para servidores); pretty = legible para desarrollo local
  LOG_FORMAT: Joi.string().valid('json', 'pretty').default('json'),

  // PostgreSQL
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  DATABASE_MIGRATION_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).optional(),
  DATABASE_POOL_MIN: Joi.number().integer().min(0).default(2),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  REDIS_KEY_PREFIX: Joi.string().default('eliza:'),

  // Keycloak
  KEYCLOAK_BASE_URL: Joi.string().uri().required(),
  KEYCLOAK_REALM: Joi.string().required(),
  KEYCLOAK_CLIENT_ID: Joi.string().required(),
  KEYCLOAK_CLIENT_SECRET: Joi.string().required(),
  KEYCLOAK_JWKS_URI: Joi.string().uri().required(),
  KEYCLOAK_ISSUER: Joi.string().uri().required(),
  KEYCLOAK_AUDIENCE: Joi.string().required(),
  KEYCLOAK_ADMIN_USERNAME: Joi.string().optional(),
  KEYCLOAK_ADMIN_PASSWORD: Joi.string().optional(),
  // Login de la app a través de la API (cliente confidencial con login directo).
  // Opcionales: sin ellos, POST /v1/auth/login responde 503 y el resto de la API sigue igual.
  KEYCLOAK_LOGIN_CLIENT_ID: Joi.string().allow('').optional(),
  KEYCLOAK_LOGIN_CLIENT_SECRET: Joi.string().allow('').optional(),

  // JWT
  JWT_ALGORITHM: Joi.string().valid('RS256', 'RS384', 'RS512').default('RS256'),
  JWT_CACHE_MAX_AGE_MS: Joi.number().integer().min(0).default(600000),

  // Tenant resolution
  TENANT_RESOLUTION_STRATEGY: Joi.string().default('jwt,header'),
  TENANT_HEADER_NAME: Joi.string().default('X-Tenant-Id'),
  TENANT_REQUIRE_ACTIVE: Joi.boolean().default(true),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional(),
  OTEL_SERVICE_NAME: Joi.string().default('eliza-foundation'),
  METRICS_ENABLED: Joi.boolean().default(true),
  TRACING_ENABLED: Joi.boolean().default(true),

  // Security
  HELMET_ENABLED: Joi.boolean().default(true),
  // Proxies en los que se confía para X-Forwarded-For (sintaxis de Express 'trust proxy').
  TRUST_PROXY: Joi.string().default(DEFAULT_TRUST_PROXY),
  CORS_ORIGINS: Joi.string().default(''),
  THROTTLE_TTL_SECONDS: Joi.number().integer().min(1).default(60),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),

  // Outbox dispatcher (Sprint 4)
  OUTBOX_DISPATCHER_ENABLED: Joi.boolean().default(true),
  OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).max(500).default(50),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(100).default(1000),
  OUTBOX_MAX_RETRIES: Joi.number().integer().min(1).default(5),
  OUTBOX_RETRY_BACKOFF_BASE_MS: Joi.number().integer().min(100).default(1000),
  OUTBOX_STUCK_LEASE_MS: Joi.number().integer().min(5000).default(60000),
  OUTBOX_RECLAIM_INTERVAL_MS: Joi.number().integer().min(5000).default(30000),

  // Event bus (Sprint 4)
  EVENT_BUS_TYPE: Joi.string().valid('in_memory', 'redis_streams').default('in_memory'),
  EVENT_BUS_STREAM_PREFIX: Joi.string().default('eliza:event:'),
  EVENT_BUS_CONSUMER_GROUP: Joi.string().default('eliza-foundation'),
});
