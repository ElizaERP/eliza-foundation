/**
 * OutboxStatus — máquina de estados del evento dentro del outbox.
 *
 *  Pending → Processing → Published (terminal éxito)
 *                     ↘
 *                       Failed → (con backoff) Pending → ...
 *                              ↘ (excede max retries) → DeadLetter (terminal)
 */
export enum OutboxStatus {
  Pending = 'Pending',
  Processing = 'Processing',
  Published = 'Published',
  Failed = 'Failed',
  DeadLetter = 'DeadLetter',
}

/**
 * OutboxEntry — vista de un evento persistido en `platform.outbox_events`.
 *
 * NO es un AggregateRoot tradicional: el aggregate "dueño" del evento ya
 * lo emitió. El Outbox solo encapsula el ciclo de despacho del evento al
 * bus, que tiene su propio estado y transiciones.
 */
export interface OutboxEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: OutboxMetadata;
  readonly status: OutboxStatus;
  readonly occurredAt: Date;
  readonly nextRetryAt: Date | null;
  readonly processingStartedAt: Date | null;
  readonly processingNode: string | null;
  readonly publishedAt: Date | null;
  readonly retryCount: number;
  readonly lastError: string | null;
}

export interface OutboxMetadata {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly userId?: string;
  readonly [k: string]: unknown;
}

/**
 * BusMessage — la unidad de transporte que viaja por el bus.
 * El dispatcher la construye a partir del OutboxEntry y la entrega al bus.
 */
export interface BusMessage {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly userId?: string;
  readonly payload: Record<string, unknown>;
}

export function toBusMessage(entry: OutboxEntry): BusMessage {
  return {
    id: entry.metadata.eventId ?? entry.id,
    type: entry.eventType,
    version: entry.eventVersion,
    tenantId: entry.tenantId,
    aggregateType: entry.aggregateType,
    aggregateId: entry.aggregateId,
    occurredAt: entry.metadata.occurredAt ?? entry.occurredAt.toISOString(),
    correlationId: entry.metadata.correlationId,
    causationId: entry.metadata.causationId,
    userId: entry.metadata.userId,
    payload: entry.payload,
  };
}
