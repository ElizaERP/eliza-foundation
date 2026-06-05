import { Entity } from '@eliza/shared-kernel/domain';

import { EntityName, UnitOfMeasureId } from './value-objects';

/**
 * Dimensiones de unidades. Solo se pueden convertir entre unidades de
 * la misma dimensión: kg → g (Mass), pero NO kg → ml (cross-dimension).
 */
export enum UomDimension {
  Mass = 'Mass',
  Volume = 'Volume',
  Length = 'Length',
  Count = 'Count',
  Time = 'Time',
  Temperature = 'Temperature',
}

interface UnitOfMeasureProps {
  id: UnitOfMeasureId;
  code: string;       // ej. "kg", "g", "ml", "L", "piece", "pack"
  name: EntityName;   // ej. "Kilogramo"
  symbol: string;     // símbolo corto para UIs
  dimension: UomDimension;
  toBaseFactor: number;  // multiplicador para llegar a la unidad base de la dimensión
  isActive: boolean;
}

/**
 * UnitOfMeasure — catálogo global de unidades, gestionado por Platform.
 *
 * No es multi-tenant: las unidades son universales (kg es kg). Esto
 * simplifica la conversión y reporting cross-tenant.
 *
 * El "toBaseFactor" permite conversiones:
 *   1 kg = 1000 g  → kg.toBaseFactor = 1000, g.toBaseFactor = 1
 *   convertir 2 kg a g  =  2 × 1000 / 1 = 2000 g
 */
export class UnitOfMeasure extends Entity<UnitOfMeasureProps> {
  private constructor(props: UnitOfMeasureProps) { super(props); }

  get id(): UnitOfMeasureId { return this.props.id; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name.value; }
  get symbol(): string { return this.props.symbol; }
  get dimension(): UomDimension { return this.props.dimension; }
  get toBaseFactor(): number { return this.props.toBaseFactor; }
  get isActive(): boolean { return this.props.isActive; }

  static reconstitute(props: UnitOfMeasureProps): UnitOfMeasure {
    return new UnitOfMeasure(props);
  }

  /**
   * Convierte una cantidad de esta unidad a OTRA unidad de la misma dimensión.
   * Si las dimensiones difieren, retorna null (no convertible).
   */
  convertTo(target: UnitOfMeasure, amount: number): number | null {
    if (this.dimension !== target.dimension) return null;
    const baseAmount = amount * this.toBaseFactor;
    return baseAmount / target.toBaseFactor;
  }
}
