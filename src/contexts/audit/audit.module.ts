import { Module, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import {
  GetEntityHistory,
  QueryAudit,
  RecordAudit,
  VerifyHashChain,
} from './application';
import { AUDIT_LOG_REPOSITORY } from './domain';
import { AuditInterceptor } from './infrastructure/interceptors/audit.interceptor';
import { PrismaAuditLogRepository } from './infrastructure/persistence/prisma-audit-log.repository';
import { AuditController } from './interface/http/audit.controller';

const portBindings: Provider[] = [
  PrismaAuditLogRepository,
  { provide: AUDIT_LOG_REPOSITORY, useExisting: PrismaAuditLogRepository },
];

const useCases: Provider[] = [
  RecordAudit,
  QueryAudit,
  GetEntityHistory,
  VerifyHashChain,
];

@Module({
  controllers: [AuditController],
  providers: [
    ...portBindings,
    ...useCases,
    // Interceptor global — capta TODOS los requests mutadores
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [
    AUDIT_LOG_REPOSITORY,
    RecordAudit,
    QueryAudit,
  ],
})
export class AuditContextModule {}
