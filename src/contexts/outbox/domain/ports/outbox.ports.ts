import { BusMessage, OutboxEntry, OutboxStatus } from '../outbox-entry';

/**
 * =====================================================================
 * EventBusPort
 * =====================================================================
 * Publicador de eventos al transporte (in-memory en dev, Redis Streams
 * en prod, futuro Kafka tras extracción a microservicios).
 *
 * El bus es agnóstico al contenido: solo recibe `BusMessage`.
 */
export interface EventBusPort {
  /**
   * Publica una lista de mensajes. La implementación decide si las
   * envía en serie o en batch. Debe ser at-least-once: si falla, el
   * dispatcher reintentará.
   *
   * @throws Si la entrega falla; el dispatcher captura y aplica retry.
   */
  publish(messages: BusMessage[]): Promise<void>;

  /**
   * Suscribir un handler a un tipo de evento.
   * Se llama durante el bootstrap; cada subscriber concreto se registra
   * a sí mismo aquí en su `OnApplicationBootstrap`.
   */
  subscribe(eventType: string, handler: EventHandler): void;

  /** Suscribir a TODOS los eventos (útil para audit subscriber, projectors). */
  subscribeAll(handler: EventHandler): void;
}

export type EventHandler = (message: BusMessage) => Promise<void>;

export const EVENT_BUS_PORT = Symbol('EventBusPort');

/**
 * =====================================================================
 * OutboxRepositoryPort
 * =====================================================================
 * Lectura y mutación de los registros de la outbox.
 *
 * El despacho usa SELECT FOR UPDATE SKIP LOCKED + UPDATE para "leasear"
 * un batch a un dispatcher: ningún otro dispatcher tomará los mismos.
 */
export interface OutboxRepositoryPort {
  /**
   * Leasea hasta `batchSize` eventos en estado Pending y los marca como
   * Processing con el nodo actual. Devuelve los eventos para publicar.
   */
  leaseNextBatch(args: LeaseBatchInput): Promise<OutboxEntry[]>;

  /** Marca un evento como Published (terminal éxito). */
  markPublished(eventId: string, publishedAt: Date): Promise<void>;

  /**
   * Marca como Failed y programa el próximo retry con backoff.
   * Si retryCount >= maxRetries, transición a DeadLetter.
   */
  markFailed(args: MarkFailedInput): Promise<void>;

  /**
   * Re-encola eventos cuyo lease expiró (dispatcher caído mid-process).
   * Los pasa de Processing → Pending con nextRetryAt=now.
   */
  reclaimStuck(staleProcessingBeforeMs: number): Promise<number>;

  /** Cuenta eventos por estado para métricas. */
  countByStatus(): Promise<Record<OutboxStatus, number>>;

  /** Busca con filtros y paginación. */
  query(filter: OutboxQueryFilter): Promise<OutboxQueryResult>;

  /** Trae uno por id. */
  findById(id: string): Promise<OutboxEntry | null>;

  /** Replay: vuelve a poner un evento en Pending con retryCount=0. */
  replay(id: string): Promise<void>;
}

export interface LeaseBatchInput {
  batchSize: number;
  processingNode: string;
  now: Date;
}

export interface MarkFailedInput {
  eventId: string;
  error: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date | null;
  now: Date;
}

export interface OutboxQueryFilter {
  status?: OutboxStatus[];
  tenantId?: string;
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface OutboxQueryResult {
  items: OutboxEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const OUTBOX_REPOSITORY = Symbol('OutboxRepository');

/**
 * =====================================================================
 * ProjectionCheckpointPort
 * =====================================================================
 * Cada proyector mantiene un checkpoint: el último evento que procesó.
 * Esto sirve para:
 *   - Idempotencia: si recibe el mismo evento dos veces, lo salta
 *   - Recovery: tras reinicio, el proyector continúa donde quedó
 */
export interface ProjectionCheckpointPort {
  getCheckpoint(projectionName: string): Promise<ProjectionCheckpoint | null>;
  recordSuccess(args: { projectionName: string; eventId: string; now: Date }): Promise<void>;
  recordFailure(args: { projectionName: string; error: string; now: Date }): Promise<void>;
}

export interface ProjectionCheckpoint {
  projectionName: string;
  lastProcessedEventId: string | null;
  lastProcessedAt: Date | null;
  eventsProcessed: bigint;
  lastErrorAt: Date | null;
  lastError: string | null;
}

export const PROJECTION_CHECKPOINT_PORT = Symbol('ProjectionCheckpointPort');
