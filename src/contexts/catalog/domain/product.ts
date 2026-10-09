import { AggregateRoot, DomainError, Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  BOMUpdated,
  ProductActivated,
  ProductCreated,
  ProductDiscontinued,
  ProductUpdated,
} from './catalog-events';
import {
  BOMComponentId,
  Barcode,
  CategoryId,
  EntityName,
  ProductCode,
  ProductId,
  Quantity,
  Sku,
  TemperatureRange,
  UnitOfMeasureId,
  Weight,
} from './value-objects';

// =====================================================================
// Enums
// =====================================================================
export enum ProductType {
  RawMaterial = 'RawMaterial',
  SemiFinished = 'SemiFinished',
  FinishedGood = 'FinishedGood',
  Service = 'Service',
}

export enum ProductStatus {
  Draft = 'Draft',
  Active = 'Active',
  Discontinued = 'Discontinued',
}

const VALID_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  [ProductStatus.Draft]: [ProductStatus.Active, ProductStatus.Discontinued],
  [ProductStatus.Active]: [ProductStatus.Discontinued],
  [ProductStatus.Discontinued]: [],
};

// =====================================================================
// BOMComponent
// =====================================================================
export interface BOMComponentProps {
  id: BOMComponentId;
  componentProductId: ProductId;
  quantity: Quantity;
  uomId: UnitOfMeasureId;
  position: number;
  notes: string | null;
}

export class BOMComponent {
  private constructor(private readonly _props: BOMComponentProps) {}
  get id(): BOMComponentId { return this._props.id; }
  get componentProductId(): ProductId { return this._props.componentProductId; }
  get quantity(): Quantity { return this._props.quantity; }
  get uomId(): UnitOfMeasureId { return this._props.uomId; }
  get position(): number { return this._props.position; }
  get notes(): string | null { return this._props.notes; }

  static create(args: {
    componentProductId: ProductId;
    quantity: Quantity;
    uomId: UnitOfMeasureId;
    position?: number;
    notes?: string;
  }): BOMComponent {
    return new BOMComponent({
      id: BOMComponentId.generate(),
      componentProductId: args.componentProductId,
      quantity: args.quantity,
      uomId: args.uomId,
      position: args.position ?? 0,
      notes: args.notes?.trim() || null,
    });
  }

  static reconstitute(props: BOMComponentProps): BOMComponent {
    return new BOMComponent(props);
  }
}

// =====================================================================
// Product Aggregate Root
// =====================================================================
interface ProductProps {
  code: ProductCode;
  sku: Sku;
  barcode: Barcode | null;
  name: EntityName;
  description: string | null;
  type: ProductType;
  status: ProductStatus;
  tenantId: string;
  categoryId: CategoryId;
  unitOfSaleId: UnitOfMeasureId;
  packSize: number | null;
  netWeight: Weight | null;
  grossWeight: Weight | null;
  expiryDays: number | null;
  storageTemperature: TemperatureRange | null;
  taxRate: number | null;
  /** Precio de lista en COP, sin IVA. null = el producto aún no tiene precio. */
  salePrice: number | null;
  imageUrl: string | null;
  isControlled: boolean;
  components: BOMComponent[];
  createdAt: Date;
  updatedAt: Date;
}

export class Product extends AggregateRoot<ProductId, ProductProps> {
  private constructor(id: ProductId, props: ProductProps, version: number) {
    super(id, props, version);
  }

  // ---------- Getters ----------
  get tenantId(): string { return this.props.tenantId; }
  get code(): string { return this.props.code.value; }
  get sku(): string { return this.props.sku.value; }
  get barcode(): string | null { return this.props.barcode?.value ?? null; }
  get name(): string { return this.props.name.value; }
  get description(): string | null { return this.props.description; }
  get type(): ProductType { return this.props.type; }
  get status(): ProductStatus { return this.props.status; }
  get categoryId(): CategoryId { return this.props.categoryId; }
  get unitOfSaleId(): UnitOfMeasureId { return this.props.unitOfSaleId; }
  get packSize(): number | null { return this.props.packSize; }
  get netWeight(): Weight | null { return this.props.netWeight; }
  get grossWeight(): Weight | null { return this.props.grossWeight; }
  get expiryDays(): number | null { return this.props.expiryDays; }
  get storageTemperature(): TemperatureRange | null { return this.props.storageTemperature; }
  get taxRate(): number | null { return this.props.taxRate; }
  get salePrice(): number | null { return this.props.salePrice; }
  get imageUrl(): string | null { return this.props.imageUrl; }
  get isControlled(): boolean { return this.props.isControlled; }
  get components(): ReadonlyArray<BOMComponent> { return this.props.components; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  // ---------- Factory ----------
  static create(args: {
    tenantId: string;
    code: string;
    sku: string;
    barcode?: string;
    name: string;
    description?: string;
    type: ProductType;
    categoryId: string;
    unitOfSaleId: string;
    packSize?: number;
    netWeightGrams?: number;
    grossWeightGrams?: number;
    expiryDays?: number;
    storageTempMinC?: number;
    storageTempMaxC?: number;
    taxRate?: number;
    imageUrl?: string;
    isControlled?: boolean;
    now: Date;
  }): Result<Product, DomainError> {
    const codeR = ProductCode.create(args.code);
    if (codeR.isErr) return err(codeR.error);
    const skuR = Sku.create(args.sku);
    if (skuR.isErr) return err(skuR.error);
    const nameR = EntityName.create(args.name, 'productName');
    if (nameR.isErr) return err(nameR.error);

    let barcode: Barcode | null = null;
    if (args.barcode) {
      const barR = Barcode.create(args.barcode);
      if (barR.isErr) return err(barR.error);
      barcode = barR.value;
    }

    let netWeight: Weight | null = null;
    if (args.netWeightGrams !== undefined) {
      const wR = Weight.fromGrams(args.netWeightGrams);
      if (wR.isErr) return err(wR.error);
      netWeight = wR.value;
    }

    let grossWeight: Weight | null = null;
    if (args.grossWeightGrams !== undefined) {
      const wR = Weight.fromGrams(args.grossWeightGrams);
      if (wR.isErr) return err(wR.error);
      grossWeight = wR.value;
    }

    if (netWeight && grossWeight && grossWeight.grams < netWeight.grams) {
      return err({ code: 'product.gross_less_than_net', message: 'Gross weight cannot be less than net weight' });
    }

    let storageTemperature: TemperatureRange | null = null;
    if (args.storageTempMinC !== undefined && args.storageTempMaxC !== undefined) {
      const tR = TemperatureRange.create(args.storageTempMinC, args.storageTempMaxC);
      if (tR.isErr) return err(tR.error);
      storageTemperature = tR.value;
    }

    if (args.expiryDays !== undefined && (!Number.isInteger(args.expiryDays) || args.expiryDays <= 0)) {
      return err({ code: 'product.expiry_invalid', message: 'expiryDays must be a positive integer' });
    }
    if (args.packSize !== undefined && (!Number.isInteger(args.packSize) || args.packSize <= 0)) {
      return err({ code: 'product.pack_size_invalid', message: 'packSize must be a positive integer' });
    }
    if (args.taxRate !== undefined && (args.taxRate < 0 || args.taxRate > 100)) {
      return err({ code: 'product.tax_rate_invalid', message: 'taxRate must be between 0 and 100' });
    }

    if (args.type === ProductType.Service) {
      if (netWeight || grossWeight || args.expiryDays !== undefined || storageTemperature) {
        return err({ code: 'product.service_no_physical_attrs', message: 'Service products cannot have weight, expiry, or storage temperature' });
      }
    }

    const isControlled = args.isControlled ?? (args.type === ProductType.FinishedGood);
    if (isControlled && args.type !== ProductType.Service) {
      if (!args.expiryDays || !storageTemperature) {
        return err({ code: 'product.controlled_requires_metadata', message: 'Controlled products require expiryDays and storage temperature range' });
      }
    }

    const id = ProductId.generate();
    const product = new Product(id, {
      code: codeR.value,
      sku: skuR.value,
      barcode,
      name: nameR.value,
      description: args.description?.trim() || null,
      type: args.type,
      status: ProductStatus.Draft,
      tenantId: args.tenantId,
      categoryId: CategoryId.fromString(args.categoryId),
      unitOfSaleId: UnitOfMeasureId.fromString(args.unitOfSaleId),
      packSize: args.packSize ?? null,
      netWeight,
      grossWeight,
      expiryDays: args.expiryDays ?? null,
      storageTemperature,
      taxRate: args.taxRate ?? null,
      salePrice: null,
      imageUrl: args.imageUrl?.trim() || null,
      isControlled,
      components: [],
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    product.addDomainEvent(new ProductCreated({
      productId: id.value,
      tenantId: args.tenantId,
      code: codeR.value.value,
      sku: skuR.value.value,
      name: nameR.value.value,
      type: args.type,
      categoryId: args.categoryId,
      isControlled,
    }));

    return ok(product);
  }

  // ---------- State transitions ----------
  activate(now: Date): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.status].includes(ProductStatus.Active)) {
      return err({ code: 'product.invalid_status_transition', message: `Cannot transition from ${this.props.status} to Active` });
    }
    this.props = { ...this.props, status: ProductStatus.Active, updatedAt: now };
    this.incrementVersion();

    this.addDomainEvent(new ProductActivated({
      productId: this._id.value,
      tenantId: this.props.tenantId,
      code: this.props.code.value,
      sku: this.props.sku.value,
      type: this.props.type,
    }));
    return ok(undefined);
  }

  discontinue(reason: string, now: Date): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.status].includes(ProductStatus.Discontinued)) {
      return err({ code: 'product.invalid_status_transition', message: `Cannot transition from ${this.props.status} to Discontinued` });
    }
    if (!reason || reason.trim().length < 3) {
      return err({ code: 'product.reason_required', message: 'A reason of at least 3 characters is required' });
    }
    this.props = { ...this.props, status: ProductStatus.Discontinued, updatedAt: now };
    this.incrementVersion();

    this.addDomainEvent(new ProductDiscontinued({
      productId: this._id.value,
      tenantId: this.props.tenantId,
      reason: reason.trim(),
    }));
    return ok(undefined);
  }

  rename(newName: string, now: Date): Result<void, DomainError> {
    if (this.props.status === ProductStatus.Discontinued) {
      return err({ code: 'product.cannot_modify_discontinued', message: 'Cannot modify discontinued product' });
    }
    const nameR = EntityName.create(newName, 'productName');
    if (nameR.isErr) return err(nameR.error);
    if (nameR.value.value === this.props.name.value) return ok(undefined);

    this.props = { ...this.props, name: nameR.value, updatedAt: now };
    this.incrementVersion();

    this.addDomainEvent(new ProductUpdated({
      productId: this._id.value,
      tenantId: this.props.tenantId,
      changes: ['name'],
    }));
    return ok(undefined);
  }

  /**
   * Fija (o quita, con null) el precio de lista en COP sin IVA. Se redondea a centavos.
   * Un producto descontinuado no cambia de precio.
   */
  setSalePrice(salePrice: number | null, now: Date): Result<void, DomainError> {
    if (this.props.status === ProductStatus.Discontinued) {
      return err({ code: 'product.cannot_modify_discontinued', message: 'Cannot modify discontinued product' });
    }
    if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0)) {
      return err({ code: 'product.sale_price_invalid', message: 'salePrice must be a positive number or null' });
    }
    const rounded = salePrice === null ? null : Math.round(salePrice * 100) / 100;
    if (rounded === this.props.salePrice) return ok(undefined);

    this.props = { ...this.props, salePrice: rounded, updatedAt: now };
    this.incrementVersion();

    this.addDomainEvent(new ProductUpdated({
      productId: this._id.value,
      tenantId: this.props.tenantId,
      changes: ['salePrice'],
    }));
    return ok(undefined);
  }

  setBOM(args: {
    components: Array<{
      componentProductId: string;
      quantity: number | string;
      uomId: string;
      position?: number;
      notes?: string;
    }>;
    now: Date;
  }): Result<void, DomainError> {
    if (this.props.status === ProductStatus.Discontinued) {
      return err({ code: 'product.cannot_modify_discontinued', message: 'Cannot modify BOM of discontinued product' });
    }
    if (this.props.type === ProductType.Service || this.props.type === ProductType.RawMaterial) {
      return err({ code: 'product.cannot_have_bom', message: 'Services and raw materials cannot have a BOM' });
    }

    const newComponents: BOMComponent[] = [];
    let totalQuantity = 0;
    const seenComponents = new Set<string>();

    for (const c of args.components) {
      if (c.componentProductId === this._id.value) {
        return err({ code: 'product.bom_self_reference', message: 'A product cannot be its own component' });
      }
      if (seenComponents.has(c.componentProductId)) {
        return err({ code: 'product.bom_duplicate_component', message: `Component ${c.componentProductId} appears more than once in BOM` });
      }
      seenComponents.add(c.componentProductId);

      const qR = Quantity.create(c.quantity);
      if (qR.isErr) return err(qR.error);

      newComponents.push(BOMComponent.create({
        componentProductId: ProductId.fromString(c.componentProductId),
        quantity: qR.value,
        uomId: UnitOfMeasureId.fromString(c.uomId),
        position: c.position,
        notes: c.notes,
      }));
      totalQuantity += qR.value.amount;
    }

    this.props = { ...this.props, components: newComponents, updatedAt: args.now };
    this.incrementVersion();

    this.addDomainEvent(new BOMUpdated({
      productId: this._id.value,
      tenantId: this.props.tenantId,
      componentCount: newComponents.length,
      totalQuantity,
    }));

    return ok(undefined);
  }

  static reconstitute(args: {
    id: ProductId;
    tenantId: string;
    code: ProductCode;
    sku: Sku;
    barcode: Barcode | null;
    name: EntityName;
    description: string | null;
    type: ProductType;
    status: ProductStatus;
    categoryId: CategoryId;
    unitOfSaleId: UnitOfMeasureId;
    packSize: number | null;
    netWeight: Weight | null;
    grossWeight: Weight | null;
    expiryDays: number | null;
    storageTemperature: TemperatureRange | null;
    taxRate: number | null;
    salePrice: number | null;
    imageUrl: string | null;
    isControlled: boolean;
    components: BOMComponent[];
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Product {
    return new Product(args.id, {
      code: args.code,
      sku: args.sku,
      barcode: args.barcode,
      name: args.name,
      description: args.description,
      type: args.type,
      status: args.status,
      tenantId: args.tenantId,
      categoryId: args.categoryId,
      unitOfSaleId: args.unitOfSaleId,
      packSize: args.packSize,
      netWeight: args.netWeight,
      grossWeight: args.grossWeight,
      expiryDays: args.expiryDays,
      storageTemperature: args.storageTemperature,
      taxRate: args.taxRate,
      salePrice: args.salePrice,
      imageUrl: args.imageUrl,
      isControlled: args.isControlled,
      components: args.components,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}
