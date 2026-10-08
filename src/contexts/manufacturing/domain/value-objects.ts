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
// Identifiers
// =====================================================================

export class OrdenProduccionId extends Identifier<'OrdenProduccion'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): OrdenProduccionId { return new OrdenProduccionId(v); }
  static generate(): OrdenProduccionId { return new OrdenProduccionId(newTimeOrderedUuid()); }
}

export class ConsumoMpId extends Identifier<'ConsumoMp'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): ConsumoMpId { return new ConsumoMpId(v); }
  static generate(): ConsumoMpId { return new ConsumoMpId(newTimeOrderedUuid()); }
}

export class LoteProducidoId extends Identifier<'LoteProducido'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): LoteProducidoId { return new LoteProducidoId(v); }
  static generate(): LoteProducidoId { return new LoteProducidoId(newTimeOrderedUuid()); }
}

// =====================================================================
// Enums
// =====================================================================

/**
 * EstadoOrdenProduccion — máquina de estados.
 *
 *   Planificada  → orden creada, BOM snapshot capturado
 *   EnProceso    → producción arrancó, MP reservada/despachada
 *   Completada   → lotes PT registrados, orden finalizada
 *   Cerrada      → revisada y archivada (terminal)
 *   Cancelada    → abortada, reservas liberadas (terminal)
 */
export enum EstadoOrdenProduccion {
  Planificada = 'Planificada',
  EnProceso = 'EnProceso',
  Completada = 'Completada',
  Cerrada = 'Cerrada',
  Cancelada = 'Cancelada',
}

export enum PrioridadProduccion {
  Alta = 'Alta',
  Media = 'Media',
  Baja = 'Baja',
}

// =====================================================================
// Value Objects
// =====================================================================

interface CodigoOrdenProps { value: string; }

/**
 * CodigoOrdenProduccion — código legible de la orden.
 * Ej: "OP-2026-06-001", "OP-ARP-MINI-001".
 * Debe empezar con "OP-" seguido de alfanumérico con guiones.
 */
export class CodigoOrdenProduccion extends ValueObject<CodigoOrdenProps> {
  private static readonly PATTERN = /^OP-[A-Z0-9][A-Z0-9-]{1,46}$/;
  private constructor(p: CodigoOrdenProps) { super(p); }
  get value(): string { return this.props.value; }

  static create(raw: string): Result<CodigoOrdenProduccion, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'codigoOrden'),
      Guard.againstLengthOutOfBounds(raw, 'codigoOrden', 4, 50),
      Guard.againstInvalidPattern(raw, 'codigoOrden', CodigoOrdenProduccion.PATTERN,
        'must start with OP- followed by uppercase alphanumeric/hyphens'),
    );
    if (v.isErr) return err(v.error);
    return ok(new CodigoOrdenProduccion({ value: raw }));
  }
}

interface CantidadObjetivoProps { amount: number; }

/**
 * CantidadObjetivo — cantidad que se desea producir.
 * Siempre positiva. Se define al crear la orden y no cambia.
 */
export class CantidadObjetivo extends ValueObject<CantidadObjetivoProps> {
  private constructor(p: CantidadObjetivoProps) { super(p); }
  get amount(): number { return this.props.amount; }

  static create(raw: number): Result<CantidadObjetivo, DomainError> {
    if (!Number.isFinite(raw) || raw <= 0) {
      return err({ code: 'cantidad_objetivo.must_be_positive',
        message: 'Target quantity must be a positive finite number' });
    }
    const rounded = Math.round(raw * 1_000_000) / 1_000_000;
    return ok(new CantidadObjetivo({ amount: rounded }));
  }
}

// =====================================================================
// BOM Snapshot — captura del BOM al crear la orden
// =====================================================================

/**
 * Snapshot inmutable de un componente del BOM.
 * Se captura al crear la OrdenDeProduccion para que cambios
 * futuros al BOM del producto no alteren órdenes existentes.
 */
export interface ComponenteBomSnapshot {
  /** ID del producto (materia prima) del Catalog */
  productId: string;
  /** Código del producto (para display) */
  productCode: string;
  /** Nombre del producto */
  productName: string;
  /** Cantidad por unidad de PT (viene del BOM) */
  cantidadPorUnidad: number;
  /** Cantidad total requerida = cantidadPorUnidad × cantidadObjetivo */
  cantidadTotalRequerida: number;
  /** Unidad de medida (ej: "kg", "un") */
  unidadMedida: string;
}