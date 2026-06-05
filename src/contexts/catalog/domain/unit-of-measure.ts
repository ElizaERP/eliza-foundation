import { Entity, Identifier } from '@eliza/shared-kernel/domain';

import { EntityName, UnitOfMeasureId } from './value-objects';

export enum UomDimension {
  Mass = 'Mass',
  Volume = 'Volume',
  Length = 'Length',
  Count = 'Count',
  Time = 'Time',
  Temperature = 'Temperature',
}

interface UnitOfMeasureProps {
  code: string;
  name: EntityName;
  symbol: string;
  dimension: UomDimension;
  toBaseFactor: number;
  isActive: boolean;
}

export class UnitOfMeasure extends Entity<UnitOfMeasureId, UnitOfMeasureProps> {
  private constructor(id: UnitOfMeasureId, props: UnitOfMeasureProps) {
    super(id, props);
  }

  get code(): string { return this.props.code; }
  get name(): string { return this.props.name.value; }
  get symbol(): string { return this.props.symbol; }
  get dimension(): UomDimension { return this.props.dimension; }
  get toBaseFactor(): number { return this.props.toBaseFactor; }
  get isActive(): boolean { return this.props.isActive; }

  static reconstitute(id: UnitOfMeasureId, props: UnitOfMeasureProps): UnitOfMeasure {
    return new UnitOfMeasure(id, props);
  }

  convertTo(target: UnitOfMeasure, amount: number): number | null {
    if (this.dimension !== target.dimension) return null;
    const baseAmount = amount * this.toBaseFactor;
    return baseAmount / target.toBaseFactor;
  }
}
