import { AggregateRoot, DomainError, Result, err, ok } from '@eliza/shared-kernel/domain';

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
  RawMaterial = 'RawMaterial',     // Materia prima (queso, harina, masa)
  SemiFinished = 'SemiFinished',   // Producto en proceso (masa lista, arepa cruda)
  FinishedGood = 'FinishedGood',   // Producto terminado (Arepa Mini 12u)
  Service = 'Service',             // No inventariado (transporte, instalación)
}

export enum ProductStatus {
  Draft = 'Draft',                  // Recién creado, no se puede vender ni producir aún
  Active = 'Active',                // En catálogo activo
  Discontinued = 'Discontinued',    // Terminal: no se puede reactivar
}

const VALID_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  [ProductStatus.Draft]:        [ProductStatus.Active, ProductStatus.Discontinued],
  [ProductStatus.Active]:       [ProductStatus.Discontinued],
  [ProductStatus.Discontinued]: [],
};

// =====================================================================
// BOMComponent — entidad anidada en Product
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
  private constructor(private readonly props: BOMComponentProps) {}

  get id(): BOMComponentId { return this.props.id; }
  get componentProductId(): ProductId { return this.props.componentProductId; }
  get quantity(): Quantity { return this.props.quantity; }
  get uomId(): UnitOfMeasureId { return this.props.uomId; }
  get position(): number { return this.props.position; }
  get notes(): string | null { return this.props.notes; }

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
// Product aggregate root
// =====================================================================

interface ProductProps {
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

  // Atributos físicos
  packSize: number | null;
  netWeight: Weight | null;
  grossWeight: Weight | null;
  expiryDays: number | null;
  storageTemperature: TemperatureRange | null;

  // Comercial
  taxRate: number | null;
  imageUrl: string | null;
  isControlled: boolean;

  components: BOMComponent[];

  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------- Domain Events ----------
export interface ProductCreatedPayload {
  productId: string;
  code: string;
  sku: string;
  name: string;
  type: ProductType;
  categoryId: string;
  isControlled: boolean;
}

export interface ProductActivatedPayload {
  productId: string;
  code: string;
  sku: string;
  type: ProductType;
}

export interface ProductDiscontinuedPayload {
  productId: string;
  reason: string;
}

export interface ProductUpdatedPayload {
  productId: string;
  changes: string[];
}

export interface BOMUpdatedPayload {
  productId: string;
  componentCount: number;
  totalQuantity: number;
}

/**
 * Product — aggregate root del Catalog.
 *
 * Invariantes garantizadas:
 *   1. Code y SKU únicos por tenant (enforce en repo)
 *   2. Transiciones de estado siguen la máquina (Draft → Active → Discontinued)
 *   3. Servicios no tienen peso ni vida útil ni temperatura
 *   4. Productos controlados deben tener vida útil y rango de temperatura
 *   5. BOM no puede contener al producto mismo (no self-reference)
 *   6. Productos en Draft no pueden tener BOM activo (poco útil)
 *   7. Productos Discontinued no aceptan modificaciones
 */
export class Product extends AggregateRoot<ProductProps> {
  private constructor(props: ProductProps) { super(props); }

  // ---------- Getters ----------
  get id(): ProductId { return this.props.id; }
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
  get imageUrl(): string | null { return this.props.imageUrl; }
  get isControlled(): boolean { return this.props.isControlled; }
  get components(): ReadonlyArray<BOMComponent> { return this.props.components; }
  get version(): number { return this.props.version; }
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
      return err({ code: 'product.gross_less_than_net',
        message: 'Gross weight cannot be less than net weight' });
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

    // Invariantes: Service no debe tener atributos físicos
    if (args.type === ProductType.Service) {
      if (netWeight || grossWeight || args.expiryDays !== undefined || storageTemperature) {
        return err({ code: 'product.service_no_physical_attrs',
          message: 'Service products cannot have weight, expiry, or storage temperature' });
      }
    }

    // Productos controlados (cadena fría, lote) deben tener vida útil + temp
    const isControlled = args.isControlled ?? (args.type === ProductType.FinishedGood);
    if (isControlled && args.type !== ProductType.Service) {
      if (!args.expiryDays || !storageTemperature) {
        return err({ code: 'product.controlled_requires_metadata',
          message: 'Controlled products require expiryDays and storage temperature range' });
      }
    }

    const id = ProductId.generate();
    const product = new Product({
      id,
      tenantId: args.tenantId,
      code: codeR.value,
      sku: skuR.value,
      barcode,
      name: nameR.value,
      description: args.description?.trim() || null,
      type: args.type,
      status: ProductStatus.Draft,
      categoryId: CategoryId.fromString(args.categoryId),
      unitOfSaleId: UnitOfMeasureId.fromString(args.unitOfSaleId),
      packSize: args.packSize ?? null,
      netWeight,
      grossWeight,
      expiryDays: args.expiryDays ?? null,
      storageTemperature,
      taxRate: args.taxRate ?? null,
      imageUrl: args.imageUrl?.trim() || null,
      isControlled,
      components: [],
      version: 1,
      createdAt: args.now,
      updatedAt: args.now,
    });

    product.addDomainEvent<ProductCreatedPayload>({
      type: 'catalog.ProductCreated.v1',
      aggregateType: 'Product',
      aggregateId: id.value,
      tenantId: args.tenantId,
      payload: {
        productId: id.value,
        code: codeR.value.value,
        sku: skuR.value.value,
        name: nameR.value.value,
        type: args.type,
        categoryId: args.categoryId,
        isControlled,
      },
      occurredAt: args.now,
      version: 1,
    });

    return ok(product);
  }

  // ---------- State transitions ----------
  activate(now: Date): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.status].includes(ProductStatus.Active)) {
      return err({ code: 'product.invalid_status_transition',
        message: `Cannot transition from ${this.props.status} to Active`,
        details: { current: this.props.status } });
    }
    this.props.status = ProductStatus.Active;
    this.props.updatedAt = now;
    this.incrementVersion();

    this.addDomainEvent<ProductActivatedPayload>({
      type: 'catalog.ProductActivated.v1',
      aggregateType: 'Product',
      aggregateId: this.props.id.value,
      tenantId: this.props.tenantId,
      payload: {
        productId: this.props.id.value,
        code: this.props.code.value,
        sku: this.props.sku.value,
        type: this.props.type,
      },
      occurredAt: now,
      version: 1,
    });
    return ok(undefined);
  }

  discontinue(reason: string, now: Date): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.status].includes(ProductStatus.Discontinued)) {
      return err({ code: 'product.invalid_status_transition',
        message: `Cannot transition from ${this.props.status} to Discontinued` });
    }
    if (!reason || reason.trim().length < 3) {
      return err({ code: 'product.reason_required',
        message: 'A reason of at least 3 characters is required to discontinue a product' });
    }
    this.props.status = ProductStatus.Discontinued;
    this.props.updatedAt = now;
    this.incrementVersion();

    this.addDomainEvent<ProductDiscontinuedPayload>({
      type: 'catalog.ProductDiscontinued.v1',
      aggregateType: 'Product',
      aggregateId: this.props.id.value,
      tenantId: this.props.tenantId,
      payload: { productId: this.props.id.value, reason: reason.trim() },
      occurredAt: now,
      version: 1,
    });
    return ok(undefined);
  }

  // ---------- Updates (solo si no es Discontinued) ----------
  rename(newName: string, now: Date): Result<void, DomainError> {
    if (this.props.status === ProductStatus.Discontinued) {
      return err({ code: 'product.cannot_modify_discontinued', message: 'Cannot modify discontinued product' });
    }
    const nameR = EntityName.create(newName, 'productName');
    if (nameR.isErr) return err(nameR.error);
    if (nameR.value.value === this.props.name.value) return ok(undefined);

    this.props.name = nameR.value;
    this.props.updatedAt = now;
    this.incrementVersion();

    this.addDomainEvent<ProductUpdatedPayload>({
      type: 'catalog.ProductUpdated.v1',
      aggregateType: 'Product',
      aggregateId: this.props.id.value,
      tenantId: this.props.tenantId,
      payload: { productId: this.props.id.value, changes: ['name'] },
      occurredAt: now,
      version: 1,
    });
    return ok(undefined);
  }

  // ---------- BOM management ----------
  /**
   * Reemplaza COMPLETAMENTE el BOM del producto.
   * Más simple que add/remove uno por uno, y consistente con el patrón "PUT".
   */
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
      return err({ code: 'product.cannot_modify_discontinued',
        message: 'Cannot modify BOM of discontinued product' });
    }
    if (this.props.type === ProductType.Service || this.props.type === ProductType.RawMaterial) {
      return err({ code: 'product.cannot_have_bom',
        message: 'Services and raw materials cannot have a BOM' });
    }

    const newComponents: BOMComponent[] = [];
    let totalQuantity = 0;

    for (const c of args.components) {
      if (c.componentProductId === this.props.id.value) {
        return err({ code: 'product.bom_self_reference',
          message: 'A product cannot be its own component' });
      }
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

    // Detectar duplicados
    const seenComponents = new Set<string>();
    for (const c of newComponents) {
      const k = c.componentProductId.value;
      if (seenComponents.has(k)) {
        return err({ code: 'product.bom_duplicate_component',
          message: `Component ${k} appears more than once in BOM` });
      }
      seenComponents.add(k);
    }

    this.props.components = newComponents;
    this.props.updatedAt = args.now;
    this.incrementVersion();

    this.addDomainEvent<BOMUpdatedPayload>({
      type: 'catalog.BOMUpdated.v1',
      aggregateType: 'Product',
      aggregateId: this.props.id.value,
      tenantId: this.props.tenantId,
      payload: {
        productId: this.props.id.value,
        componentCount: newComponents.length,
        totalQuantity,
      },
      occurredAt: args.now,
      version: 1,
    });

    return ok(undefined);
  }

  static reconstitute(props: ProductProps): Product {
    return new Product(props);
  }
}
