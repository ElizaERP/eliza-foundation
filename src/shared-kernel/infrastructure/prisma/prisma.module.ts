import { Global, Module } from '@nestjs/common';

import { UNIT_OF_WORK_PORT } from '../../application/ports';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { PrismaService } from './prisma.service';

/**
 * Global module: PrismaService está disponible en todos los módulos
 * sin necesidad de re-importar. Justificado porque es infraestructura
 * transversal del Modular Monolith.
 *
 * UNIT_OF_WORK_PORT: varias operaciones (incluso de distintos bounded
 * contexts) en una sola transacción de PostgreSQL.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    PrismaUnitOfWork,
    { provide: UNIT_OF_WORK_PORT, useExisting: PrismaUnitOfWork },
  ],
  exports: [PrismaService, UNIT_OF_WORK_PORT],
})
export class PrismaModule {}
