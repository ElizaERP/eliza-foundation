import { DomainEvent } from './domain-event';
import { Entity } from './entity';
import { Identifier } from './identifier';

/**
 * Aggregate Root base (DDD).
 *
 * El Aggregate Root es la única entidad de un Aggregate que es accesible
 * desde fuera del agregado. Garantiza invariantes y consistencia
 * transaccional. Es la unidad mínima de persistencia.
 *
 * Reglas en ELIZA:
 *   1. Solo el Aggregate Root expone su Identifier al exterior.
 *   2. Las entidades hijas se referencian SOLO desde el root.
 *   3. Cualquier modificación del estado interno se hace vía métodos
 *      del root (encapsulación). No hay setters públicos.
 *   4. Cada cambio de estado relevante emite un Domain Event vía
 *      `addDomainEvent()`.
 *   5. El repositorio drena los eventos con `pullDomainEvents()` y los
 *      persiste en la outbox en la misma transacción.
 *   6. La versión (`version`) se incrementa en cada cambio para
 *      optimistic concurrency control en el repositorio.
 *
 * Ejemplos en ELIZA: Tenant, User, AuditLog, OrdenDeVenta, Lote.
 */
export abstract class AggregateRoot<
  Id extends Identifier<string>,
  Props extends object,
> extends Entity<Id, Props> {
  private _domainEvents: DomainEvent[] = [];
  private _version: number;

  protected constructor(id: Id, props: Props, version = 1) {
    super(id, props);
    this._version = version;
  }

  get version(): number {
    return this._version;
  }

  /** Drena los eventos acumulados (lo llama el repositorio). */
  pullDomainEvents(): DomainEvent[] {
    const events = this._domainEvents;
    this._domainEvents = [];
    return events;
  }

  /** Devuelve los eventos pendientes sin drenarlos (para inspección). */
  peekDomainEvents(): ReadonlyArray<DomainEvent> {
    return [...this._domainEvents];
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /** Lo invocan los métodos mutadores tras cambiar el estado. */
  protected incrementVersion(): void {
    this._version += 1;
  }
}
