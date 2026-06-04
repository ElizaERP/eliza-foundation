import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Global module: PrismaService está disponible en todos los módulos
 * sin necesidad de re-importar. Justificado porque es infraestructura
 * transversal del Modular Monolith.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
