import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { ClsService } from 'nestjs-cls';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { DEFAULT_TRUST_PROXY } from './config/trust-proxy';
import { ProblemDetailsExceptionFilter } from './shared-kernel/infrastructure/exceptions/problem-details.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  // -------- IP real del cliente detrás de los proxies --------
  // Cadena en DEV: cliente → Tailscale (Serve/Funnel) → Nginx (red de Docker) → API.
  // Se confía en X-Forwarded-For solo cuando lo agrega un proxy de red privada
  // (loopback, link-local, 10/8, 172.16/12, 192.168/16). Express recorre la
  // cabecera de derecha a izquierda y req.ip queda en la primera IP no confiable:
  // la del cliente. Un X-Forwarded-For inventado por el cliente queda a la
  // izquierda y se ignora.
  app.set('trust proxy', config.get<string>('TRUST_PROXY', DEFAULT_TRUST_PROXY));

  // -------- Logger Pino como logger global --------
  app.useLogger(app.get(PinoLogger));

  // -------- Seguridad --------
  if (config.get<boolean>('HELMET_ENABLED', true)) {
    app.use(helmet({
      contentSecurityPolicy: false, // ajustamos por endpoint si fuese necesario
    }));
  }
  const corsOrigins = config.get<string>('CORS_ORIGINS', '').split(',').filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
    exposedHeaders: ['X-Correlation-Id'],
  });

  // -------- Compresión --------
  app.use(compression());

  // -------- Versionado de API por URI: /api/v1/... --------
  app.setGlobalPrefix(config.get<string>('APP_GLOBAL_PREFIX', 'api'));
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.get<string>('APP_VERSION', 'v1').replace(/^v/, ''),
    prefix: 'v',
  });

  // -------- Validación global (DTOs class-validator) --------
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    stopAtFirstError: false,
  }));

  // -------- Filtro global Problem Details RFC 7807 --------
  app.useGlobalFilters(new ProblemDetailsExceptionFilter(app.get(ClsService)));

  // -------- OpenAPI / Swagger --------
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('ELIZA Foundation Platform API')
      .setDescription(
        'Foundation Platform — Tenant Management · Identity & Access · Audit. ' +
        'Modular Monolith built with NestJS + DDD + Hexagonal.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT issued by Keycloak',
      })
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // -------- Graceful shutdown --------
  app.enableShutdownHooks();

  const port = config.get<number>('APP_PORT', 3000);
  await app.listen(port);
  // El logger ya está activo: este log saldrá estructurado.
  // eslint-disable-next-line no-console
  console.log(`🚀 ELIZA Foundation Platform listening on http://localhost:${port}/api/v1`);
  // eslint-disable-next-line no-console
  console.log(`📖 OpenAPI docs at http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
