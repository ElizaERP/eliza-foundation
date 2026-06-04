import { Global, Module } from '@nestjs/common';

import { PrismaModule } from './prisma/prisma.module';
import { TenantContextModule } from './tenant-context/tenant-context.module';

/**
 * Shared Kernel module — agrupa la infraestructura transversal del
 * Modular Monolith. Es @Global para que todos los bounded contexts
 * la consuman sin re-imports.
 *
 * Lo que NO va aquí:
 *   - Lógica de negocio (vive en los bounded contexts)
 *   - Modelos específicos de un BC (Tenant, User, AuditLog viven en sus BCs)
 *   - Controllers HTTP (cada BC expone los suyos)
 */
@Global()
@Module({
  imports: [
    TenantContextModule,
    PrismaModule,
  ],
  exports: [
    TenantContextModule,
    PrismaModule,
  ],
})
export class SharedKernelModule {}
