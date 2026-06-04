import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus as PrismaOutboxStatus, Prisma } from '@prisma/client';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';

import {
  LeaseBatchInput,
  MarkFailedInput,
  OutboxEntry,
  OutboxQueryFilter,
  OutboxQueryResult,
  OutboxRepositoryPort,
  OutboxStatus,
} from '../../domain';

/**
 * PrismaOutboxRepository — adapter al outbox table.
 *
 * Características críticas:
 *   1. `leaseNextBatch` usa SELECT ... FOR UPDATE SKIP LOCKED para que
 *      múltiples dispatchers (multi-pod en k8s) no agarren los mismos
 *      eventos. PostgreSQL nativo, sin necesidad de Redis lock.
 *   2. Filtra `nextRetryAt <= now` para respetar el backoff.
 *   3. NUNCA propaga RLS (outbox es cross-tenant, opera con
 *      unsafeWithoutTenant explícitamente).
 */
@Injectable()
export class PrismaOutboxRepository implements OutboxRepositoryPort {
  private readonly logger = new Logger(PrismaOutboxRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async leaseNextBatch(input: LeaseBatchInput): Promise<OutboxEntry[]> {
    return this.prisma.unsafeWithoutTenant(async (tx) => {
      // PostgreSQL: SELECT FOR UPDATE SKIP LOCKED → exclusivo entre dispatchers
      const rows: Array<{ id: string }> = await tx.$queryRaw`
        SELECT id FROM platform.outbox_events
        WHERE status = 'Pending'
          AND (next_retry_at IS NULL OR next_retry_at <= ${input.now})
        ORDER BY occurred_at ASC
        LIMIT ${input.batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);

      // Marcar como Processing + tag con el nodo
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: {
          status: PrismaOutboxStatus.Processing,
          processingStartedAt: input.now,
          processingNode: input.processingNode,
        },
      });

      // Cargar los eventos completos
      const full = await tx.outboxEvent.findMany({
        where: { id: { in: ids } },
      });

      // Preservar el orden FIFO original
      const byId = new Map(full.map((e) => [e.id, e]));
      return ids.map((id) => byId.get(id)!).filter(Boolean).map((row) => this.toEntry(row));
    }, 'OutboxRepository.leaseNextBatch — concurrent dispatcher leasing');
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    await this.prisma.unsafeWithoutTenant(
      (tx) => tx.outboxEvent.update({
        where: { id: eventId },
        data: {
          status: PrismaOutboxStatus.Published,
          publishedAt,
          processingStartedAt: null,
          processingNode: null,
          lastError: null,
          nextRetryAt: null,
        },
      }),
      'OutboxRepository.markPublished',
    );
  }

  async markFailed(input: MarkFailedInput): Promise<void> {
    const isDeadLetter = input.retryCount >= input.maxRetries;
    await this.prisma.unsafeWithoutTenant(
      (tx) => tx.outboxEvent.update({
        where: { id: input.eventId },
        data: {
          status: isDeadLetter ? PrismaOutboxStatus.DeadLetter : PrismaOutboxStatus.Pending,
          retryCount: input.retryCount,
          lastError: input.error.slice(0, 4000),
          nextRetryAt: input.nextRetryAt,
          processingStartedAt: null,
          processingNode: null,
        },
      }),
      'OutboxRepository.markFailed',
    );
  }

  async reclaimStuck(staleProcessingBeforeMs: number): Promise<number> {
    const threshold = new Date(Date.now() - staleProcessingBeforeMs);
    const result = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.outboxEvent.updateMany({
        where: {
          status: PrismaOutboxStatus.Processing,
          processingStartedAt: { lt: threshold },
        },
        data: {
          status: PrismaOutboxStatus.Pending,
          processingStartedAt: null,
          processingNode: null,
          nextRetryAt: new Date(),
        },
      }),
      'OutboxRepository.reclaimStuck — recover crashed dispatchers',
    );
    return result.count;
  }

  async countByStatus(): Promise<Record<OutboxStatus, number>> {
    const rows = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.outboxEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      'OutboxRepository.countByStatus',
    );
    const result: Record<OutboxStatus, number> = {
      [OutboxStatus.Pending]: 0,
      [OutboxStatus.Processing]: 0,
      [OutboxStatus.Published]: 0,
      [OutboxStatus.Failed]: 0,
      [OutboxStatus.DeadLetter]: 0,
    };
    for (const row of rows) {
      result[row.status as unknown as OutboxStatus] = row._count._all;
    }
    return result;
  }

  async query(filter: OutboxQueryFilter): Promise<OutboxQueryResult> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 50, 200);
    const skip = (page - 1) * pageSize;

    const where: Prisma.OutboxEventWhereInput = {};
    if (filter.status && filter.status.length > 0) {
      where.status = { in: filter.status as unknown as PrismaOutboxStatus[] };
    }
    if (filter.tenantId) where.tenantId = filter.tenantId;
    if (filter.eventType) where.eventType = filter.eventType;
    if (filter.aggregateType) where.aggregateType = filter.aggregateType;
    if (filter.aggregateId) where.aggregateId = filter.aggregateId;
    if (filter.from || filter.to) {
      where.occurredAt = {};
      if (filter.from) where.occurredAt.gte = filter.from;
      if (filter.to) where.occurredAt.lte = filter.to;
    }

    const [rows, total] = await this.prisma.unsafeWithoutTenant(
      (tx) => Promise.all([
        tx.outboxEvent.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip,
          take: pageSize,
        }),
        tx.outboxEvent.count({ where }),
      ]),
      'OutboxRepository.query',
    );

    return {
      items: rows.map((r) => this.toEntry(r)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findById(id: string): Promise<OutboxEntry | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.outboxEvent.findUnique({ where: { id } }),
      'OutboxRepository.findById',
    );
    return row ? this.toEntry(row) : null;
  }

  async replay(id: string): Promise<void> {
    await this.prisma.unsafeWithoutTenant(
      (tx) => tx.outboxEvent.update({
        where: { id },
        data: {
          status: PrismaOutboxStatus.Pending,
          retryCount: 0,
          nextRetryAt: null,
          processingStartedAt: null,
          processingNode: null,
          lastError: null,
          publishedAt: null,
        },
      }),
      'OutboxRepository.replay',
    );
  }

  // -------- Helper --------
  private toEntry(row: {
    id: string;
    tenantId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    eventVersion: number;
    payload: unknown;
    metadata: unknown;
    status: PrismaOutboxStatus;
    occurredAt: Date;
    nextRetryAt: Date | null;
    processingStartedAt: Date | null;
    processingNode: string | null;
    publishedAt: Date | null;
    retryCount: number;
    lastError: string | null;
  }): OutboxEntry {
    return {
      id: row.id,
      tenantId: row.tenantId,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      payload: (row.payload as Record<string, unknown>) ?? {},
      metadata: (row.metadata as Record<string, unknown>) as never,
      status: row.status as unknown as OutboxStatus,
      occurredAt: row.occurredAt,
      nextRetryAt: row.nextRetryAt,
      processingStartedAt: row.processingStartedAt,
      processingNode: row.processingNode,
      publishedAt: row.publishedAt,
      retryCount: row.retryCount,
      lastError: row.lastError,
    };
  }
}
