import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorStatus,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { PrismaService } from '../../shared-kernel/infrastructure/prisma/prisma.service';

/**
 * Health checks expuestos en /health (sin prefijo de versión).
 *
 * - GET /health        → liveness, devuelve 200 si el proceso está vivo
 * - GET /health/ready  → readiness, valida dependencias (Postgres, Redis, etc.)
 * - GET /health/db     → ping específico a Postgres
 *
 * Estos endpoints están EXCLUIDOS del TenantContextMiddleware en
 * AppModule.configure(), por lo que NO requieren JWT ni tenant.
 *
 * Las probes de Kubernetes apuntan a /health y /health/ready.
 */
@ApiTags('Health')
@Public()
@Controller({ path: 'health', version: '' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe — el proceso responde' })
  liveness(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — todas las dependencias OK' })
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.pingPostgres(),
    ]);
  }

  @Get('db')
  @HealthCheck()
  @ApiOperation({ summary: 'Postgres ping explícito (sin RLS, sin tenant)' })
  database(): Promise<HealthCheckResult> {
    return this.health.check([() => this.pingPostgres()]);
  }

  private async pingPostgres(): Promise<HealthIndicatorResult> {
    const key = 'postgres';
    try {
      // SELECT 1 directo: no requiere app.tenant_id porque no toca tablas con RLS.
      const start = Date.now();
      const result = await this.prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
      const latencyMs = Date.now() - start;

      const ok = result[0]?.ok === 1;
      return {
        [key]: {
          status: (ok ? 'up' : 'down') as HealthIndicatorStatus,
          latencyMs,
        },
      };
    } catch (err) {
      return {
        [key]: {
          status: 'down' as HealthIndicatorStatus,
          error: (err as Error).message,
        },
      };
    }
  }
}
