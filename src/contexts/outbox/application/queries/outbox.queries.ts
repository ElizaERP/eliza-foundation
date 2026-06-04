import { Inject, Injectable } from '@nestjs/common';

import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, ok } from '@eliza/shared-kernel/domain';

import {
  OUTBOX_REPOSITORY,
  OutboxRepositoryPort,
  OutboxStatus,
} from '../../domain';
import { OutboxEntryView, toOutboxEntryView } from '../dto/outbox-entry.view';

// =====================================================================
// GetOutboxStats — métricas operativas
// =====================================================================
export interface OutboxStatsOutput {
  counts: Record<OutboxStatus, number>;
  pending: number;
  processing: number;
  published: number;
  failed: number;
  deadLetter: number;
  total: number;
}

@Injectable()
export class GetOutboxStats implements UseCase<void, OutboxStatsOutput> {
  constructor(@Inject(OUTBOX_REPOSITORY) private readonly repo: OutboxRepositoryPort) {}

  async execute(): Promise<Result<OutboxStatsOutput, ApplicationError>> {
    const counts = await this.repo.countByStatus();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return ok({
      counts,
      pending: counts[OutboxStatus.Pending] ?? 0,
      processing: counts[OutboxStatus.Processing] ?? 0,
      published: counts[OutboxStatus.Published] ?? 0,
      failed: counts[OutboxStatus.Failed] ?? 0,
      deadLetter: counts[OutboxStatus.DeadLetter] ?? 0,
      total,
    });
  }
}

// =====================================================================
// QueryOutbox — listar/filtrar eventos
// =====================================================================
export interface QueryOutboxInput {
  status?: OutboxStatus[];
  tenantId?: string;
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface QueryOutboxOutput {
  items: OutboxEntryView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class QueryOutbox implements UseCase<QueryOutboxInput, QueryOutboxOutput> {
  constructor(@Inject(OUTBOX_REPOSITORY) private readonly repo: OutboxRepositoryPort) {}

  async execute(input: QueryOutboxInput): Promise<Result<QueryOutboxOutput, ApplicationError>> {
    const result = await this.repo.query({
      status: input.status,
      tenantId: input.tenantId,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
      page: input.page,
      pageSize: input.pageSize,
    });
    return ok({
      items: result.items.map(toOutboxEntryView),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  }
}

// =====================================================================
// ListDeadLetter — vista específica de DLQ
// =====================================================================
@Injectable()
export class ListDeadLetter implements UseCase<{ page?: number; pageSize?: number }, QueryOutboxOutput> {
  constructor(@Inject(OUTBOX_REPOSITORY) private readonly repo: OutboxRepositoryPort) {}

  async execute(input: { page?: number; pageSize?: number }) {
    const result = await this.repo.query({
      status: [OutboxStatus.DeadLetter],
      page: input.page,
      pageSize: input.pageSize,
    });
    return ok<QueryOutboxOutput, ApplicationError>({
      items: result.items.map(toOutboxEntryView),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  }
}
