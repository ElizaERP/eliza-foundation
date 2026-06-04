import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';

import { DiagnosticsController } from './diagnostics/diagnostics.controller';
import { HealthController } from './health/health.controller';

/**
 * Agrupa los controllers de diagnóstico de la Foundation Platform.
 * DiagnosticsController se registra SOLO en non-production para evitar
 * que /errors/:type esté expuesto en producción.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class FoundationDiagnosticsModule {
  static register(opts: { exposeDiagnostics: boolean }) {
    return {
      module: FoundationDiagnosticsModule,
      imports: [TerminusModule],
      controllers: opts.exposeDiagnostics
        ? [HealthController, DiagnosticsController]
        : [HealthController],
    };
  }
}
