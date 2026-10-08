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

export class ProductId extends Identifier<'Product'> {
  private constructor(value: string) {
    super(value);
  }
  static fromString(v: string): ProductId {
    return new ProductId(v);
  }
  static generate(): ProductId {
    return new ProductId(newTimeOrderedUuid());
  }
}

export class CategoryId extends Identifier<'Category'> {
  private constructor(value: string) {
    super(value);
  }
  static fromString(v: string): CategoryId {
    return new CategoryId(v);
  }
  static generate(): CategoryId {
    return new CategoryId(newTimeOrderedUuid());
  }
}

export class UnitOfMeasureId extends Identifier<'UnitOfMeasure'> {
  private constructor(value: string) {
    super(value);
  }
  static fromString(v: string): UnitOfMeasureId {
    return new UnitOfMeasureId(v);
  }
  static generate(): UnitOfMeasureId {
    return new UnitOfMeasureId(newTimeOrderedUuid());
  }
}

export class BOMComponentId extends Identifier<'BOMComponent'> {
  private constructor(value: string) {
    super(value);
  }
  static fromString(v: string): BOMComponentId {
    return new BOMComponentId(v);
  }
  static generate(): BOMComponentId {
    return new BOMComponentId(newTimeOrderedUuid());
  }
}

// =====================================================================
// Value Objects
// =====================================================================

interface CodeProps {
  value: string;
}

export class ProductCode extends ValueObject<CodeProps> {
  private static readonly PATTERN = /^[A-Z][A-Z0-9-]{1,49}$/;
  private constructor(p: CodeProps) {
    super(p);
  }
  get value(): string {
    return this.props.value;
  }
  static create(raw: string): Result<ProductCode, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'productCode'),
      Guard.againstLengthOutOfBounds(raw, 'productCode', 2, 50),
      Guard.againstInvalidPattern(
        raw,
        'productCode',
        ProductCode.PATTERN,
        'uppercase letter followed by A-Z, 0-9 and hyphens',
      ),
    );
    if (v.isErr) return err(v.error);
    return ok(new ProductCode({ value: raw }));
  }
}

export class Sku extends ValueObject<CodeProps> {
  private static readonly PATTERN = /^[A-Z0-9][A-Z0-9-]{1,49}$/;
  private constructor(p: CodeProps) {
    super(p);
  }
  get value(): string {
    return this.props.value;
  }
  static create(raw: string): Result<Sku, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'sku'),
      Guard.againstLengthOutOfBounds(raw, 'sku', 2, 50),
      Guard.againstInvalidPattern(raw, 'sku', Sku.PATTERN, 'alphanumeric with hyphens'),
    );
    if (v.isErr) return err(v.error);
    return ok(new Sku({ value: raw }));
  }
}

interface NameProps {
  value: string;
}
export class EntityName extends ValueObject<NameProps> {
  private constructor(p: NameProps) {
    super(p);
  }
  get value(): string {
    return this.props.value;
  }
  static create(raw: string, label = 'name'): Result<EntityName, DomainError> {
    const trimmed = (raw ?? '').trim();
    const v = Guard.combine(
      Guard.againstEmptyString(trimmed, label),
      Guard.againstLengthOutOfBounds(trimmed, label, 1, 200),
    );
    if (v.isErr) return err(v.error);
    return ok(new EntityName({ value: trimmed }));
  }
}

interface BarcodeProps {
  value: string;
}
export class Barcode extends ValueObject<BarcodeProps> {
  private static readonly PATTERN = /^[0-9]{8,14}$/;
  private constructor(p: BarcodeProps) {
    super(p);
  }
  get value(): string {
    return this.props.value;
  }
  static create(raw: string): Result<Barcode, DomainError> {
    const v = Guard.combine(
      Guard.againstEmptyString(raw, 'barcode'),
      Guard.againstInvalidPattern(raw, 'barcode', Barcode.PATTERN, '8-14 digits'),
    );
    if (v.isErr) return err(v.error);
    return ok(new Barcode({ value: raw }));
  }
}

interface QuantityProps {
  amount: number;
}
export class Quantity extends ValueObject<QuantityProps> {
  private constructor(p: QuantityProps) {
    super(p);
  }
  get amount(): number {
    return this.props.amount;
  }
  static create(raw: number | string): Result<Quantity, DomainError> {
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(n) || n <= 0) {
      return err({
        code: 'quantity.invalid',
        message: 'Quantity must be a positive finite number',
      });
    }
    const rounded = Math.round(n * 1_000_000) / 1_000_000;
    return ok(new Quantity({ amount: rounded }));
  }
}

interface WeightProps {
  grams: number;
}
export class Weight extends ValueObject<WeightProps> {
  private constructor(p: WeightProps) {
    super(p);
  }
  get grams(): number {
    return this.props.grams;
  }
  static fromGrams(g: number): Result<Weight, DomainError> {
    if (!Number.isFinite(g) || g <= 0) {
      return err({
        code: 'weight.invalid',
        message: 'Weight must be a positive finite number in grams',
      });
    }
    return ok(new Weight({ grams: Math.round(g * 1000) / 1000 }));
  }
}

interface TemperatureRangeProps {
  minC: number;
  maxC: number;
}
export class TemperatureRange extends ValueObject<TemperatureRangeProps> {
  private constructor(p: TemperatureRangeProps) {
    super(p);
  }
  get minC(): number {
    return this.props.minC;
  }
  get maxC(): number {
    return this.props.maxC;
  }
  static create(
    minC: number,
    maxC: number,
  ): Result<TemperatureRange, DomainError> {
    if (!Number.isFinite(minC) || !Number.isFinite(maxC)) {
      return err({
        code: 'temperature.invalid',
        message: 'Min/Max must be finite numbers',
      });
    }
    if (minC > maxC) {
      return err({
        code: 'temperature.invalid_range',
        message: `minC (${minC}) cannot exceed maxC (${maxC})`,
      });
    }
    return ok(new TemperatureRange({ minC, maxC }));
  }
}
