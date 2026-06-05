import { ulid } from 'ulid';

/**
 * Domain Event base (DDD + Event-Driven).
 *
 * Todo evento de dominio en ELIZA DEBE:
 *   1. Ser inmutable (frozen tras construcción).
 *   2. Llevar `tenantId` obligatorio (multi-tenancy first class).
 *   3. Llevar `occurredAt` con timezone (UTC).
 *   4. Tener `eventId` único y ordenable temporalmente (ULID).
 *   5. Declarar `eventType` y `eventVersion` para versionado de contratos.
 *   6. Soportar `correlationId` y `causationId` para trazabilidad
 *      cross-context (Saga, Outbox, Audit).
 *
 * El Aggregate Root acumula eventos en una lista; el repositorio los
 * persiste vía Outbox Pattern en la misma transacción que el agregado.
 * El Outbox Dispatcher los publica al bus interno (in-process CQRS) o
 * externo (futuro Kafka/RabbitMQ al extraer microservicios).
 *
 * Naming: VerboPasadoSustantivo en PascalCase. Ej: TenantCreated,
 * UserActivated, RoleAssigned. Coherente con el Event Catalog del
 * Documento 9 (Event Driven).
 */
export interface DomainEventMetadata {
  /** Identificador del evento, ULID, ordenable temporalmente. */
  readonly eventId: string;
  /** Tenant al que pertenece el evento. Obligatorio. */
  readonly tenantId: string;
  /** Nombre del evento. Ej: 'tenant.TenantCreated.v1'. */
  readonly eventType: string;
  /** Versión del contrato del evento. Cambia con cada breaking change. */
  readonly eventVersion: number;
  /** Tipo del agregado raíz. Ej: 'Tenant', 'User'. */
  readonly aggregateType: string;
  /** ID del agregado raíz que emitió el evento. */
  readonly aggregateId: string;
  /** Momento del evento, UTC, ISO-8601. */
  readonly occurredAt: Date;
  /** ID de la operación que originó la cadena (request HTTP, job, etc.). */
  readonly correlationId?: string;
  /** Evento que causó este evento (para cadenas de eventos). */
  readonly causationId?: string;
  /** Usuario que disparó la operación; null para operaciones de sistema. */
  readonly userId?: string;
}

export abstract class DomainEvent {
  readonly metadata: DomainEventMetadata;

  protected constructor(metadata: Omit<DomainEventMetadata, 'eventId' | 'occurredAt'> & {
    eventId?: string;
    occurredAt?: Date;
  }) {
    this.metadata = Object.freeze({
      eventId: metadata.eventId ?? ulid(),
      occurredAt: metadata.occurredAt ?? new Date(),
      ...metadata,
    });
  }

  /** Payload específico del evento, serializable a JSON. */
  abstract payload(): Record<string, any>;

  toJSON(): Record<string, unknown> {
    return {
      ...this.metadata,
      occurredAt: this.metadata.occurredAt.toISOString(),
      payload: this.payload(),
    };
  }
}
