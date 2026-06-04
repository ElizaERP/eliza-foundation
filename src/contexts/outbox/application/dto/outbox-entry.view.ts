import { OutboxEntry } from '../../domain';

export interface OutboxEntryView {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: string;
  occurredAt: string;
  nextRetryAt: string | null;
  processingStartedAt: string | null;
  processingNode: string | null;
  publishedAt: string | null;
  retryCount: number;
  lastError: string | null;
}

export function toOutboxEntryView(entry: OutboxEntry): OutboxEntryView {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    aggregateType: entry.aggregateType,
    aggregateId: entry.aggregateId,
    eventType: entry.eventType,
    eventVersion: entry.eventVersion,
    payload: entry.payload,
    metadata: entry.metadata as Record<string, unknown>,
    status: entry.status,
    occurredAt: entry.occurredAt.toISOString(),
    nextRetryAt: entry.nextRetryAt?.toISOString() ?? null,
    processingStartedAt: entry.processingStartedAt?.toISOString() ?? null,
    processingNode: entry.processingNode,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    retryCount: entry.retryCount,
    lastError: entry.lastError,
  };
}
