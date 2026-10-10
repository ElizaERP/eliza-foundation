import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Prisma, PrismaClient } from '@prisma/client';

import { TENANT_CONTEXT_PORT, TenantContextPort } from '../../application/ports';

/** Clave CLS de la transacción de la unidad de trabajo en curso (ver inTransaction). */
const CLS_PRISMA_TX = 'eliza.prisma.tx';

/**
 * PrismaService — adapter que envuelve PrismaClient y garantiza que TODA
 * operación se ejecute con el `app.tenant_id` GUC establecido en la
 * conexión, activando RLS.
 *
 * Por qué un extension en lugar de middleware: Prisma deprecó middlewares
 * en favor de Client Extensions. La extensión intercepta cada query y
 * envuelve la operación en una transacción que primero hace
 * `SET LOCAL app.tenant_id = ...` y luego ejecuta la query.
 *
 * Excepciones (queries sin tenant context):
 *   - Bootstrap: provisión inicial de tenants (Platform Admin)
 *   - Cross-tenant analytics autorizado (SET ROLE bypass, ver Doc 11)
 *   - Migraciones (corren con migration_user, otro role)
 * Para esos casos, usar `unsafeWithoutTenant()` explícitamente.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    private readonly cls: ClsService,
  ) {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });

    // En desarrollo, loggear queries lentas (>200ms) con sus parámetros.
    if (process.env.NODE_ENV !== 'production') {
      // @ts-expect-error PrismaClient.$on signature for typed events
      this.$on('query', (e: Prisma.QueryEvent) => {
        if (e.duration > 200) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Ejecuta `work` dentro de una transacción con `app.tenant_id`
   * establecido. Usar para TODA operación de negocio.
   *
   * Patrón: el repositorio adapter llama a este método y dentro pasa
   * el `tx` (TransactionClient) a sus operaciones de Prisma.
   */
  async withTenant<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    // Dentro de una unidad de trabajo (inTransaction) se reutiliza su
    // transacción: todo lo que hagan los repositorios se confirma o se
    // revierte junto.
    const ambient = this.ambientTx();
    if (ambient) return work(ambient);

    const tenantId = this.tenantContext.getTenantId();
    const userId = this.tenantContext.tryGetUserId();
    const correlationId = this.tenantContext.getCorrelationId();

    return this.$transaction(async (tx) => {
      // SET LOCAL: el setting vive solo dentro de esta transacción y
      // se limpia automáticamente al COMMIT/ROLLBACK. Inmune a leaks
      // entre requests gracias al pool de conexiones.
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      if (userId) {
        await tx.$executeRawUnsafe(`SET LOCAL app.user_id = '${userId}'`);
      }
      await tx.$executeRawUnsafe(`SET LOCAL app.correlation_id = '${correlationId}'`);

      return work(tx);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 30_000,
    });
  }

  /**
   * Unidad de trabajo: ejecuta `work` en UNA sola transacción con
   * `app.tenant_id`, y cada `withTenant` que se llame dentro (aunque sea
   * desde repositorios de otros bounded contexts) usa esa misma
   * transacción. Si `work` lanza, se revierte todo.
   *
   * La transacción viaja en el contexto CLS del request; anidar
   * `inTransaction` reutiliza la exterior. Usar a través de UNIT_OF_WORK_PORT.
   */
  async inTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.ambientTx()) return work();
    return this.withTenant(async (tx) => {
      this.cls.set(CLS_PRISMA_TX, tx);
      try {
        return await work();
      } finally {
        this.cls.set(CLS_PRISMA_TX, undefined);
      }
    });
  }

  private ambientTx(): Prisma.TransactionClient | undefined {
    return this.cls.isActive() ? this.cls.get<Prisma.TransactionClient | undefined>(CLS_PRISMA_TX) : undefined;
  }

  /**
   * Escape hatch para queries que LEGÍTIMAMENTE necesitan ejecutarse sin
   * contexto de tenant (provisión inicial, cross-tenant analytics).
   * El uso debe ser EXPLÍCITO y auditado.
   *
   * Si lo necesitas, escribe un test que justifique por qué.
   */
  async unsafeWithoutTenant<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    reason: string,
  ): Promise<T> {
    this.logger.warn(
      `Executing query WITHOUT tenant context. Reason: ${reason}. ` +
      `This bypasses RLS and must be audited.`,
    );
    return this.$transaction(work);
  }
}
