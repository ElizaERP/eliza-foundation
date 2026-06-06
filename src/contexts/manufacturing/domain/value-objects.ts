import { ulid } from 'ulid';

import {
  DomainError,
  Guard,
  Identifier,
  Result,
  ValueObject,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

// =====================================================================
// Identifiers
// =====================================================================

function ulidToUuid(s: string): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = new Uint8Array(16);
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (const c of s.toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[idx++] = (value >> bits) & 0xff;
      if (idx === 16) break;
    }
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export class OrdenProduccionId extends Identifier<'OrdenProduccion'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): OrdenProduccionId { return new OrdenProduccionId(v); }
  static generate(): OrdenProduccionId { return new OrdenProduccionId(ulidToUuid(ulid())); }
}

export class ConsumoMpId extends Identifier<'ConsumoMp'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): ConsumoMpId { return new ConsumoMpId(v); }
  static generate(): ConsumoMpId { return new ConsumoMpId(ulidToUuid(ulid())); }
}

export class LoteProducidoId extends Identifier<'LoteProducido'> {
  private constructor(value: string) { super(value); }
  static fromString(v: string): LoteProducidoId { return new LoteProducidoId(v); }
  static generate(): LoteProducidoId { return new LoteProducidoId(ulidToUuid(ulid())); }
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