import { Inject, Injectable } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  AUDIT_LOG_REPOSITORY,
  AuditAction,
  AuditEntry,
  AuditLogRepository,
  AuditQueryFilter,
  VerifyChainResult,
} from '@eliza/contexts/audit/domain';
import { AuditEntryView, toAuditEntryView } from '@eliza/contexts/audit/application/dto/audit-entry.view';

// =====================================================================
// RecordAudit — append explícito desde código de aplicación
// =====================================================================
export interface RecordAuditInput {
  /** Si no se especifica, usa el tenantId del contexto del request. */
  tenantId?: string;
  /** Si no se especifica, usa el userId del JWT. */
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Si no se especifica, usa correlationId del contexto. */
  correlationId?: string | null;
  causationId?: string | null;
}

@Injectable()
export class RecordAudit implements UseCase<RecordAuditInput, AuditEntryView> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY) private readonly repo: AuditLogRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: RecordAuditInput): Promise<Result<AuditEntryView, ApplicationError>> {
    const actionR = AuditAction.create(input.action);
    if (actionR.isErr) {
      return err(applicationError(actionR.error.code, actionR.error.message, 'validation', actionR.error.details));
    }

    const tenantId = input.tenantId ?? this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('audit.no_tenant_context', 'No tenant context for audit record', 'unauthorized'));
    }

    const entry = await this.repo.append({
      tenantId,
      occurredAt: this.clock.now(),
      userId: input.userId !== undefined ? input.userId : this.ctx.tryGetUserId(),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      oldValues: input.oldValues ?? null,
      newValues: input.newValues ?? null,
      correlationId: input.correlationId ?? this.ctx.getCorrelationId(),
      causationId: input.causationId ?? null,
    });

    return ok(toAuditEntryView(entry));
  }
}

// =====================================================================
// QueryAudit — búsqueda con filtros
// =====================================================================
export interface QueryAuditInput {
  userId?: string;
  action?: string[];
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  from?: string; // ISO date
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface QueryAuditOutput {
  items: AuditEntryView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class QueryAudit implements UseCase<QueryAuditInput, QueryAuditOutput> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY) private readonly repo: AuditLogRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: QueryAuditInput): Promise<Result<QueryAuditOutput, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('audit.no_tenant_context', 'Audit query requires tenant context', 'unauthorized'));
    }

    const filter: AuditQueryFilter = {
      tenantId,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      correlationId: input.correlationId,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
      page: input.page,
      pageSize: input.pageSize,
    };

    const result = await this.repo.query(filter);
    return ok({
      items: result.items.map(toAuditEntryView),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  }
}

// =====================================================================
// GetEntityHistory — todos los eventos de una entidad específica
// =====================================================================
@Injectable()
export class GetEntityHistory implements UseCase<{ entityType: string; entityId: string }, AuditEntryView[]> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY) private readonly repo: AuditLogRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { entityType: string; entityId: string }) {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('audit.no_tenant_context', 'Tenant context required', 'unauthorized'));
    }

    const result = await this.repo.query({
      tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      page: 1,
      pageSize: 500,
    });
    return ok<AuditEntryView[], ApplicationError>(result.items.map(toAuditEntryView));
  }
}

// =====================================================================
// VerifyHashChain — integridad criptográfica
// =====================================================================
export interface VerifyHashChainInput {
  tenantId?: string;
  fromChainIndex?: string;
  toChainIndex?: string;
}

@Injectable()
export class VerifyHashChain implements UseCase<VerifyHashChainInput, VerifyChainResult> {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY) private readonly repo: AuditLogRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: VerifyHashChainInput): Promise<Result<VerifyChainResult, ApplicationError>> {
    const tenantId = input.tenantId ?? this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('audit.no_tenant_context', 'Tenant context required', 'unauthorized'));
    }

    const result = await this.repo.verifyChain({
      tenantId,
      fromChainIndex: input.fromChainIndex ? BigInt(input.fromChainIndex) : undefined,
      toChainIndex: input.toChainIndex ? BigInt(input.toChainIndex) : undefined,
    });
    return ok(result);
  }
}
