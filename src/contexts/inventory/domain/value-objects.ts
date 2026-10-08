import {
  DomainError,
  Guard,
  Identifier,
  Result,
  ValueObject,
  err,
  newTimeOrderedUuid,
  ok,
} from '@eliza/shared-kernel/domain';

// =====================================================================
// Identifiers (Branded types)
// =====================================================================

export class LoteId extends Identifier<'Lote'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): LoteId { return new LoteId(v); }
  static generate(): LoteId { return new LoteId(newTimeOrderedUuid()); }
}

export class ExistenciaId extends Identifier<'Existencia'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): ExistenciaId { return new ExistenciaId(v); }
  static generate(): ExistenciaId { return new ExistenciaId(newTimeOrderedUuid()); }
}

export class ReservaId extends Identifier<'Reserva'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): ReservaId { return new ReservaId(v); }
  static generate(): ReservaId { return new ReservaId(newTimeOrderedUuid()); }
}

export class MovimientoId extends Identifier<'Movimiento'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): MovimientoId { return new MovimientoId(v); }
  static generate(): MovimientoId { return new MovimientoId(newTimeOrderedUuid()); }
}

export class WarehouseId extends Identifier<'Warehouse'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): WarehouseId { return new WarehouseId(v); }
  static generate(): WarehouseId { return new WarehouseId(newTimeOrderedUuid()); }
}

export class LocationId extends Identifier<'Location'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): LocationId { return new LocationId(v); }
  static generate(): LocationId { return new LocationId(newTimeOrderedUuid()); }
}

// =====================================================================
// Value Objects
// =====================================================================

interface CodigoLoteProps { value: string; }

/**
 * CodigoLote — identificador legible del lote, único por tenant+producto.
 * Ej: "BCM-ARP-MINI-2026-04-15-001".
 */
export class CodigoLote extends ValueObject<CodigoLoteProps> {
  private static readonly PATTERN = /^[A-Z0-9][A-Z0-9-]{2,49}$/;
  private constructor(p: CodigoLoteProps) { super(p); }
  get value(): string { return this.props.value; }
  static create(raw: string): Result<CodigoLote, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'codigoLote'),
      Guard.againstLengthOutOfBounds(raw, 'codigoLote', 3, 50),
      Guard.againstInvalidPattern(raw, 'codigoLote', CodigoLote.PATTERN,
        'uppercase alphanumeric with hyphens'),
    );
    if (v.isErr) return err(v.error);
    return ok(new CodigoLote({ value: raw }));
  }
}

interface CantidadProps { amount: number; }

/**
 * Cantidad — número positivo o cero, con hasta 6 decimales.
 * A diferencia de Quantity del Catalog (que es estrictamente positiva),
 * Cantidad permite cero porque las existencias pueden quedar en 0.
 */
export class Cantidad extends ValueObject<CantidadProps> {
  private constructor(p: CantidadProps) { super(p); }
  get amount(): number { return this.props.amount; }

  static create(raw: number | string): Result<Cantidad, DomainError> {
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(n) || n < 0) {
      return err({ code: 'cantidad.invalid', message: 'Cantidad must be a non-negative finite number' });
    }
    const rounded = Math.round(n * 1_000_000) / 1_000_000;
    return ok(new Cantidad({ amount: rounded }));
  }

  /** Como create() pero exige cantidad > 0. Útil para movimientos. */
  static createPositive(raw: number | string): Result<Cantidad, DomainError> {
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(n) || n <= 0) {
      return err({ code: 'cantidad.must_be_positive', message: 'Cantidad must be strictly positive' });
    }
    return Cantidad.create(n);
  }

  add(other: Cantidad): Cantidad {
    return new Cantidad({ amount: Math.round((this.amount + other.amount) * 1_000_000) / 1_000_000 });
  }

  subtract(other: Cantidad): Result<Cantidad, DomainError> {
    const result = Math.round((this.amount - other.amount) * 1_000_000) / 1_000_000;
    if (result < 0) {
      return err({ code: 'cantidad.would_go_negative',
        message: `Subtracting ${other.amount} from ${this.amount} would result in negative quantity` });
    }
    return ok(new Cantidad({ amount: result }));
  }

  isZero(): boolean { return this.amount === 0; }
  isGreaterThanOrEqual(other: Cantidad): boolean { return this.amount >= other.amount; }
}

interface FechaVencimientoProps { date: Date; }

/**
 * FechaVencimiento — siempre en el futuro al crearse. Inmutable después.
 */
export class FechaVencimiento extends ValueObject<FechaVencimientoProps> {
  private constructor(p: FechaVencimientoProps) { super(p); }
  get date(): Date { return this.props.date; }
  get iso(): string { return this.props.date.toISOString(); }

  static create(d: Date, now: Date): Result<FechaVencimiento, DomainError> {
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      return err({ code: 'fecha_vencimiento.invalid', message: 'Invalid date' });
    }
    if (d.getTime() <= now.getTime()) {
      return err({ code: 'fecha_vencimiento.must_be_future',
        message: `Expiry date ${d.toISOString()} must be in the future (now=${now.toISOString()})` });
    }
    return ok(new FechaVencimiento({ date: d }));
  }

  /** Para reconstituir desde BD: NO valida que esté en el futuro (puede estar vencido ya). */
  static reconstitute(d: Date): FechaVencimiento {
    return new FechaVencimiento({ date: d });
  }

  isExpired(now: Date): boolean {
    return this.props.date.getTime() <= now.getTime();
  }

  /** Días que faltan para vencer (negativo si ya venció). */
  daysUntilExpiry(now: Date): number {
    const diffMs = this.props.date.getTime() - now.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}

interface ReferenciaOrigenProps { tipo: TipoReferencia; id: string; }

/**
 * ReferenciaOrigen — qué causó un movimiento o reserva.
 * Ej: una reserva originada por un pedido tiene tipo=SalesOrder, id=<pedidoId>.
 */
export enum TipoReferencia {
  SalesOrder = 'SalesOrder',
  ProductionOrder = 'ProductionOrder',
  PurchaseOrder = 'PurchaseOrder',
  PhysicalCount = 'PhysicalCount',
  Adjustment = 'Adjustment',
  Transfer = 'Transfer',
  Manual = 'Manual',
}

export class ReferenciaOrigen extends ValueObject<ReferenciaOrigenProps> {
  private constructor(p: ReferenciaOrigenProps) { super(p); }
  get tipo(): TipoReferencia { return this.props.tipo; }
  get id(): string { return this.props.id; }
  get key(): string { return `${this.props.tipo}:${this.props.id}`; }

  static create(tipo: TipoReferencia, id: string): Result<ReferenciaOrigen, DomainError> {
    if (!id || id.trim().length === 0) {
      return err({ code: 'referencia.id_required', message: 'Reference id cannot be empty' });
    }
    return ok(new ReferenciaOrigen({ tipo, id: id.trim() }));
  }
}
