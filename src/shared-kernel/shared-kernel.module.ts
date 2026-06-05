import { Global, Module } from '@nestjs/common';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { TenantContextModule } from './infrastructure/tenant-context/tenant-context.module';

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