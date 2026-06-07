import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { envValidationSchema } from './config/env.validation';
import { AuditContextModule } from './contexts/audit/audit.module';
import { CatalogContextModule } from './contexts/catalog/catalog.module';
import { IamContextModule } from './contexts/iam/iam.module';
import { OutboxContextModule } from './contexts/outbox/outbox.module';
import { TenantContextModule } from './contexts/tenant/tenant.module';
import { FoundationDiagnosticsModule } from './shared-kernel/infrastructure/foundation-diagnostics.module';
import { SharedKernelModule } from './shared-kernel/shared-kernel.module';
import { TenantContextMiddleware } from './shared-kernel/infrastructure/tenant-context/tenant-context.middleware';
import { InventoryContextModule } from './contexts/inventory/inventory.module';
import { ManufacturingContextModule } from './contexts/manufacturing/manufacturing.module';
import { SalesContextModule } from './contexts/sales/sales.module';

/**
 * AppModule — raíz del Modular Monolith.
 *
 * Estructura:
 *   - SharedKernelModule: infraestructura transversal (Prisma, TenantContext, Clock)
 *   - <BoundedContexts>:   Tenant (Sprint 1), IAM (Sprint 2), Audit (Sprint 3)
 *   - LoggerModule (Pino): logs estructurados con correlationId/tenantId
 *   - ThrottlerModule:     rate limiting global
 *   - TerminusModule:      health checks (/health, /health/ready)
 *
 * El TenantContextMiddleware se aplica a TODAS las rutas excepto las
 * públicas (health, swagger, login callback de Keycloak).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? 'info',
          transport:
            process.env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              '*.password',
              '*.client_secret',
              '*.creditCard',
            ],
            censor: '[REDACTED]',
          },
          customProps: (req) => ({
            correlationId: (req.headers['x-correlation-id'] as string) ?? undefined,
          }),
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: Number(process.env.THROTTLE_TTL_SECONDS ?? 60) * 1000,
          limit: Number(process.env.THROTTLE_LIMIT ?? 100),
        },
      ],
    }),

    SharedKernelModule,

    FoundationDiagnosticsModule.register({
      exposeDiagnostics: process.env.NODE_ENV !== 'production',
    }),

    // -----------------------------------------------------------------
    // Bounded Contexts
    // -----------------------------------------------------------------
    IamContextModule,       // Sprint 2 ✅ — registra APP_GUARDs globales
    AuditContextModule,     // Sprint 3 ✅ — registra APP_INTERCEPTOR global
    OutboxContextModule,    // Sprint 4 ✅ — dispatcher worker + event bus
    TenantContextModule,    // Sprint 1 ✅
    CatalogContextModule,   // Sprint 5 ✅ — primer módulo de negocio
    InventoryContextModule, // Sprint 6 ✅ — Lotes, Existencias, FEFO, Kardex
    ManufacturingContextModule, // Sprint 7 ✅ — órdenes de producción
    SalesContextModule,         // Sprint 8 ✅ — Clientes y Pedidos de Venta
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantContextMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/(.*)', method: RequestMethod.GET },
        { path: 'docs', method: RequestMethod.GET },
        { path: 'docs/(.*)', method: RequestMethod.GET },
      )
      .forRoutes('*');
    // Nota: el middleware corre incluso en /platform/tenants. Los use
    // cases de Platform Admin no leen el tenantId del context — leen
    // el id del path. Si no hay tenant en el JWT (Platform Admin no
    // pertenece a un tenant), tryGetTenantId() devuelve null y los
    // use cases siguen funcionando. Solo getTenantId() (que lanza)
    // se usa en operaciones tenant-scoped como GetMyTenant.
  }
}
