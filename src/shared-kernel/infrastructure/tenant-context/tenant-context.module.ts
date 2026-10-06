import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

import { CLOCK_PORT, ClockPort, TENANT_CONTEXT_PORT } from '../../application/ports';
import { TenantContextService } from './tenant-context.service';

/**
 * SystemClock — adapter por defecto del ClockPort.
 * En tests, se reemplaza por un FakeClock que permite congelar el tiempo.
 */
class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
  nowIso(): string {
    return new Date().toISOString();
  }
}

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: false, generateId: true }, // se monta en AppModule.configure (orden)
    }),
  ],
  providers: [
    TenantContextService,
    {
      provide: TENANT_CONTEXT_PORT,
      useExisting: TenantContextService,
    },
    {
      provide: CLOCK_PORT,
      useClass: SystemClock,
    },
  ],
  exports: [TenantContextService, TENANT_CONTEXT_PORT, CLOCK_PORT, ClsModule],
})
export class TenantContextModule {}
