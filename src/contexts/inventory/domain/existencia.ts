import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  InventoryAdjusted,
  InventoryDispatched,
  InventoryReceived,
  InventoryReserved,
  ReservationReleased,
} from './inventory-events';
import {
  Cantidad,
  ExistenciaId,
  LocationId,
  LoteId,
  ReferenciaOrigen,
  ReservaId,
} from './value-objects';

/**
 * EstadoReserva — ciclo de vida de una reserva.
 *   Active     → asignada y bloqueando stock
 *   Released   → liberada manualmente o por compensación de saga
 *   Fulfilled  → la reserva se materializó en un despacho (terminal)
 */
export enum EstadoReserva {
  Active = 'Active',
  Released = 'Released',
  Fulfilled = 'Fulfilled',
}

// =====================================================================
// Reserva — entidad anidada en Existencia
// =====================================================================
export interface ReservaProps {
  id: ReservaId;
  referencia: ReferenciaOrigen;
  cantidad: Cantidad;
  estado: EstadoReserva;
  createdAt: Date;
  releasedAt: Date | null;
  releasedReason: string | null;
}

export class Reserva {
  private constructor(private _props: ReservaProps) {}

  get id(): ReservaId { return this._props.id; }
  get referencia(): ReferenciaOrigen { return this._props.referencia; }
  get cantidad(): Cantidad { return this._props.cantidad; }
  get estado(): EstadoReserva { return this._props.estado; }
  get createdAt(): Date { return this._props.createdAt; }
  get releasedAt(): Date | null { return this._props.releasedAt; }
  get releasedReason(): string | null { return this._props.releasedReason; }

  isActive(): boolean { return this._props.estado === EstadoReserva.Active; }

  static create(args: {
    referencia: ReferenciaOrigen;
    cantidad: Cantidad;
    now: Date;
  }): Reserva {
    return new Reserva({
      id: ReservaId.generate(),
      referencia: args.referencia,
      cantidad: args.cantidad,
      estado: EstadoReserva.Active,
      createdAt: args.now,
      releasedAt: null,
      releasedReason: null,
    });
  }

  static reconstitute(props: ReservaProps): Reserva {
    return new Reserva(props);
  }

  release(reason: string, now: Date): void {
    this._props = {
      ...this._props,
      estado: EstadoReserva.Released,
      releasedAt: now,
      releasedReason: reason,
    };
  }

  fulfill(now: Date): void {
    this._props = {
      ...this._props,
      estado: EstadoReserva.Fulfilled,
      releasedAt: now,
    };
  }
}

// =====================================================================
// Existencia aggregate root
// =====================================================================

interface ExistenciaProps {
  tenantId: string;
  productId: string;
  loteId: LoteId;
  locationId: LocationId;
  cantidadDisponible: Cantidad;
  cantidadReservada: Cantidad;
  cantidadBloqueada: Cantidad;
  reservas: Reserva[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Existencia — Aggregate Root.
 *
 * Representa el stock de un producto en un lote específico en una
 * ubicación específica. Es la granularidad mínima de control de
 * inventario: (tenant, product, lote, location) → existencia única.
 *
 * Invariantes críticas:
 *   1. cantidadDisponible >= 0 SIEMPRE (enforced por subtract).
 *   2. Las reservas son idempotentes por referenciaOrigen — no se
 *      crea una segunda reserva con la misma referencia.
 *   3. cantidadReservada = suma de reservas activas.
 *   4. cantidadDisponible + cantidadReservada + cantidadBloqueada = stock físico total.
 *   5. No se modifica si el lote está vencido o bloqueado (lo valida el use case).
 */
export class Existencia extends AggregateRoot<ExistenciaId, ExistenciaProps> {
  private constructor(id: ExistenciaId, props: ExistenciaProps, version: number) {
    super(id, props, version);
  }

  // ---------- Getters ----------
  get tenantId(): string { return this.props.tenantId; }
  get productId(): string { return this.props.productId; }
  get loteId(): LoteId { return this.props.loteId; }
  get locationId(): LocationId { return this.props.locationId; }
  get cantidadDisponible(): Cantidad { return this.props.cantidadDisponible; }
  get cantidadReservada(): Cantidad { return this.props.cantidadReservada; }
  get cantidadBloqueada(): Cantidad { return this.props.cantidadBloqueada; }
  get cantidadTotal(): number {
    return this.props.cantidadDisponible.amount +
      this.props.cantidadReservada.amount +
      this.props.cantidadBloqueada.amount;
  }
  get reservas(): ReadonlyArray<Reserva> { return this.props.reservas; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Verifica si hay una reserva activa con esta referencia (idempotencia). */
  findActiveReservation(referencia: ReferenciaOrigen): Reserva | null {
    return this.props.reservas.find(
      (r) => r.isActive() && r.referencia.key === referencia.key,
    ) ?? null;
  }

  // ---------- Factory ----------

  /** Crea una existencia vacía. La cantidad se agrega vía receive(). */
  static createEmpty(args: {
    tenantId: string;
    productId: string;
    loteId: string;
    locationId: string;
    now: Date;
  }): Existencia {
    const zero = Cantidad.create(0);
    if (zero.isErr) throw new Error('Unreachable: 0 must be a valid Cantidad');

    const id = ExistenciaId.generate();
    return new Existencia(id, {
      tenantId: args.tenantId,
      productId: args.productId,
      loteId: LoteId.fromString(args.loteId),
      locationId: LocationId.fromString(args.locationId),
      cantidadDisponible: zero.value,
      cantidadReservada: zero.value,
      cantidadBloqueada: zero.value,
      reservas: [],
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);
  }

  // ---------- Operations ----------

  /** Recibe stock (entrada). Aumenta cantidadDisponible. */
  receive(args: {
    cantidad: Cantidad;
    movimientoId: string;
    referencia: ReferenciaOrigen;
    now: Date;
  }): Result<void, DomainError> {
    if (args.cantidad.isZero()) {
      return err({ code: 'existencia.cantidad_zero', message: 'Cannot receive zero quantity' });
    }
    this.props = {
      ...this.props,
      cantidadDisponible: this.props.cantidadDisponible.add(args.cantidad),
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new InventoryReceived({
      existenciaId: this._id.value,
      tenantId: this.props.tenantId,
      productId: this.props.productId,
      loteId: this.props.loteId.value,
      locationId: this.props.locationId.value,
      cantidad: args.cantidad.amount,
      movimientoId: args.movimientoId,
      referenciaTipo: args.referencia.tipo,
      referenciaId: args.referencia.id,
    }));
    return ok(undefined);
  }

  /**
   * Reserva una cantidad. Idempotente: si ya hay una reserva activa con
   * la misma referencia, no crea una nueva.
   */
  reserve(args: {
    cantidad: Cantidad;
    referencia: ReferenciaOrigen;
    now: Date;
  }): Result<Reserva, DomainError> {
    // Idempotencia
    const existing = this.findActiveReservation(args.referencia);
    if (existing) {
      // Si la cantidad coincide, es la misma reserva — OK silencioso
      if (existing.cantidad.amount === args.cantidad.amount) {
        return ok(existing);
      }
      return err({ code: 'existencia.reservation_conflict',
        message: `Reservation already exists for ${args.referencia.key} with different quantity (${existing.cantidad.amount} vs requested ${args.cantidad.amount})` });
    }

    if (args.cantidad.isZero()) {
      return err({ code: 'existencia.cantidad_zero', message: 'Cannot reserve zero quantity' });
    }

    // Mover cantidad de disponible a reservada
    const subR = this.props.cantidadDisponible.subtract(args.cantidad);
    if (subR.isErr) {
      return err({ code: 'existencia.insufficient_stock',
        message: `Insufficient stock: requested ${args.cantidad.amount}, available ${this.props.cantidadDisponible.amount}`,
        details: { requested: args.cantidad.amount, available: this.props.cantidadDisponible.amount } });
    }

    const nuevaReserva = Reserva.create({
      referencia: args.referencia,
      cantidad: args.cantidad,
      now: args.now,
    });

    this.props = {
      ...this.props,
      cantidadDisponible: subR.value,
      cantidadReservada: this.props.cantidadReservada.add(args.cantidad),
      reservas: [...this.props.reservas, nuevaReserva],
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new InventoryReserved({
      existenciaId: this._id.value,
      reservaId: nuevaReserva.id.value,
      tenantId: this.props.tenantId,
      productId: this.props.productId,
      loteId: this.props.loteId.value,
      locationId: this.props.locationId.value,
      cantidad: args.cantidad.amount,
      referenciaTipo: args.referencia.tipo,
      referenciaId: args.referencia.id,
    }));

    return ok(nuevaReserva);
  }

  /** Libera una reserva por referencia. Devuelve la cantidad liberada a Disponible. */
  releaseReservation(args: {
    referencia: ReferenciaOrigen;
    reason: string;
    now: Date;
  }): Result<void, DomainError> {
    const reserva = this.findActiveReservation(args.referencia);
    if (!reserva) {
      return err({ code: 'existencia.reservation_not_found',
        message: `No active reservation found for ${args.referencia.key}` });
    }

    reserva.release(args.reason, args.now);

    // Devolver cantidad a Disponible y bajar Reservada
    const subR = this.props.cantidadReservada.subtract(reserva.cantidad);
    if (subR.isErr) {
      // Esto sería un bug de invariante: cantidadReservada debe poder absorber la liberación
      throw new Error(`Invariant violation: cantidadReservada=${this.props.cantidadReservada.amount} cannot absorb released=${reserva.cantidad.amount}`);
    }

    this.props = {
      ...this.props,
      cantidadDisponible: this.props.cantidadDisponible.add(reserva.cantidad),
      cantidadReservada: subR.value,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new ReservationReleased({
      existenciaId: this._id.value,
      reservaId: reserva.id.value,
      tenantId: this.props.tenantId,
      productId: this.props.productId,
      loteId: this.props.loteId.value,
      cantidad: reserva.cantidad.amount,
      motivo: args.reason,
    }));
    return ok(undefined);
  }

  /**
   * Despacha una cantidad reservada (la materializa fuera del inventario).
   * Marca la reserva correspondiente como Fulfilled y baja cantidadReservada.
   */
  dispatch(args: {
    referencia: ReferenciaOrigen;
    movimientoId: string;
    now: Date;
  }): Result<number, DomainError> {
    const reserva = this.findActiveReservation(args.referencia);
    if (!reserva) {
      return err({ code: 'existencia.reservation_not_found',
        message: `No active reservation found for ${args.referencia.key}` });
    }

    const cantidadDespachada = reserva.cantidad;
    reserva.fulfill(args.now);

    const subR = this.props.cantidadReservada.subtract(cantidadDespachada);
    if (subR.isErr) {
      throw new Error(`Invariant violation dispatching reservation`);
    }

    this.props = {
      ...this.props,
      cantidadReservada: subR.value,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new InventoryDispatched({
      existenciaId: this._id.value,
      tenantId: this.props.tenantId,
      productId: this.props.productId,
      loteId: this.props.loteId.value,
      cantidad: cantidadDespachada.amount,
      referenciaTipo: args.referencia.tipo,
      referenciaId: args.referencia.id,
      movimientoId: args.movimientoId,
    }));

    return ok(cantidadDespachada.amount);
  }

  /** Ajusta cantidadDisponible por +/- delta. Para conteos físicos / mermas. */
  adjust(args: {
    delta: number;
    motivo: string;
    movimientoId: string;
    now: Date;
  }): Result<void, DomainError> {
    if (args.delta === 0) {
      return err({ code: 'existencia.delta_zero', message: 'Adjustment delta cannot be zero' });
    }
    if (!args.motivo || args.motivo.trim().length < 3) {
      return err({ code: 'existencia.motivo_required',
        message: 'Adjustment requires a motivo of at least 3 characters' });
    }

    let nuevaDisponible: Cantidad;
    if (args.delta > 0) {
      const deltaR = Cantidad.createPositive(args.delta);
      if (deltaR.isErr) return err(deltaR.error);
      nuevaDisponible = this.props.cantidadDisponible.add(deltaR.value);
    } else {
      const deltaR = Cantidad.createPositive(Math.abs(args.delta));
      if (deltaR.isErr) return err(deltaR.error);
      const subR = this.props.cantidadDisponible.subtract(deltaR.value);
      if (subR.isErr) {
        return err({ code: 'existencia.adjustment_would_negative',
          message: `Cannot adjust: ${args.delta} from ${this.props.cantidadDisponible.amount} would be negative` });
      }
      nuevaDisponible = subR.value;
    }

    this.props = {
      ...this.props,
      cantidadDisponible: nuevaDisponible,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new InventoryAdjusted({
      existenciaId: this._id.value,
      tenantId: this.props.tenantId,
      productId: this.props.productId,
      loteId: this.props.loteId.value,
      locationId: this.props.locationId.value,
      delta: args.delta,
      motivo: args.motivo.trim(),
      movimientoId: args.movimientoId,
    }));
    return ok(undefined);
  }

  // ---------- Reconstitution ----------
  static reconstitute(args: {
    id: ExistenciaId;
    tenantId: string;
    productId: string;
    loteId: LoteId;
    locationId: LocationId;
    cantidadDisponible: Cantidad;
    cantidadReservada: Cantidad;
    cantidadBloqueada: Cantidad;
    reservas: Reserva[];
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Existencia {
    return new Existencia(args.id, {
      tenantId: args.tenantId,
      productId: args.productId,
      loteId: args.loteId,
      locationId: args.locationId,
      cantidadDisponible: args.cantidadDisponible,
      cantidadReservada: args.cantidadReservada,
      cantidadBloqueada: args.cantidadBloqueada,
      reservas: args.reservas,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}
