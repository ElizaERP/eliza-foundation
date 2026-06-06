import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  LocationCreated,
  WarehouseCreated,
} from './inventory-events';
import {
  LocationId,
  WarehouseId,
} from './value-objects';

/**
 * TipoUbicacion — clasificación de la ubicación física.
 */
export enum TipoUbicacion {
  Camara = 'Camara',        // Cámara de congelación / refrigeración
  Estante = 'Estante',      // Estantería en bodega seca
  Recepcion = 'Recepcion',  // Zona de descarga
  Despacho = 'Despacho',    // Zona de carga
  Cuarentena = 'Cuarentena', // Espera de inspección
  Devoluciones = 'Devoluciones',
}

// =====================================================================
// Warehouse — bodega/planta
// =====================================================================
interface WarehouseProps {
  tenantId: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Warehouse extends AggregateRoot<WarehouseId, WarehouseProps> {
  private constructor(id: WarehouseId, props: WarehouseProps, version: number) {
    super(id, props, version);
  }

  get tenantId(): string { return this.props.tenantId; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get address(): string | null { return this.props.address; }
  get isActive(): boolean { return this.props.isActive; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  static create(args: {
    tenantId: string;
    code: string;
    name: string;
    address?: string;
    now: Date;
  }): Result<Warehouse, DomainError> {
    if (!/^[A-Z][A-Z0-9-]{1,29}$/.test(args.code)) {
      return err({ code: 'warehouse.code_invalid',
        message: 'Warehouse code must be uppercase alphanumeric with hyphens, 2-30 chars' });
    }
    if (!args.name || args.name.trim().length < 2) {
      return err({ code: 'warehouse.name_invalid',
        message: 'Warehouse name must be at least 2 characters' });
    }

    const id = WarehouseId.generate();
    const warehouse = new Warehouse(id, {
      tenantId: args.tenantId,
      code: args.code,
      name: args.name.trim(),
      address: args.address?.trim() || null,
      isActive: true,
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    warehouse.addDomainEvent(new WarehouseCreated({
      warehouseId: id.value,
      tenantId: args.tenantId,
      code: args.code,
      name: args.name.trim(),
    }));
    return ok(warehouse);
  }

  static reconstitute(args: {
    id: WarehouseId;
    tenantId: string;
    code: string;
    name: string;
    address: string | null;
    isActive: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Warehouse {
    return new Warehouse(args.id, {
      tenantId: args.tenantId,
      code: args.code,
      name: args.name,
      address: args.address,
      isActive: args.isActive,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}

// =====================================================================
// Location — ubicación específica dentro de un warehouse
// =====================================================================
interface LocationProps {
  tenantId: string;
  warehouseId: WarehouseId;
  code: string;
  name: string;
  tipoUbicacion: TipoUbicacion;
  tempMinC: number | null;
  tempMaxC: number | null;
  capacidadMax: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Location extends AggregateRoot<LocationId, LocationProps> {
  private constructor(id: LocationId, props: LocationProps, version: number) {
    super(id, props, version);
  }

  get tenantId(): string { return this.props.tenantId; }
  get warehouseId(): WarehouseId { return this.props.warehouseId; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get tipoUbicacion(): TipoUbicacion { return this.props.tipoUbicacion; }
  get tempMinC(): number | null { return this.props.tempMinC; }
  get tempMaxC(): number | null { return this.props.tempMaxC; }
  get capacidadMax(): number | null { return this.props.capacidadMax; }
  get isActive(): boolean { return this.props.isActive; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /**
   * ¿La ubicación es compatible con los requerimientos de temperatura
   * de un producto? Esta verificación protege la cadena de frío.
   */
  isCompatibleWith(productTempMinC: number | null, productTempMaxC: number | null): boolean {
    if (productTempMinC === null || productTempMaxC === null) return true;
    if (this.tempMinC === null || this.tempMaxC === null) {
      // La ubicación no controla temperatura, no es apta para productos controlados
      return false;
    }
    // La ubicación debe poder mantener al menos el rango requerido por el producto
    return this.tempMinC <= productTempMinC && this.tempMaxC >= productTempMaxC;
  }

  static create(args: {
    tenantId: string;
    warehouseId: string;
    code: string;
    name: string;
    tipoUbicacion: TipoUbicacion;
    tempMinC?: number;
    tempMaxC?: number;
    capacidadMax?: number;
    now: Date;
  }): Result<Location, DomainError> {
    if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(args.code)) {
      return err({ code: 'location.code_invalid', message: 'Location code invalid format' });
    }
    if (!args.name || args.name.trim().length < 2) {
      return err({ code: 'location.name_invalid', message: 'Location name must be at least 2 chars' });
    }

    // Cámara: si se especifica temperatura, debe ser min <= max
    if (args.tempMinC !== undefined && args.tempMaxC !== undefined) {
      if (args.tempMinC > args.tempMaxC) {
        return err({ code: 'location.temp_range_invalid',
          message: `tempMinC (${args.tempMinC}) cannot exceed tempMaxC (${args.tempMaxC})` });
      }
    }

    // Cámaras siempre deben tener temperatura definida
    if (args.tipoUbicacion === TipoUbicacion.Camara) {
      if (args.tempMinC === undefined || args.tempMaxC === undefined) {
        return err({ code: 'location.camara_requires_temp',
          message: 'Cámara locations require tempMinC and tempMaxC' });
      }
    }

    const id = LocationId.generate();
    const location = new Location(id, {
      tenantId: args.tenantId,
      warehouseId: WarehouseId.fromString(args.warehouseId),
      code: args.code,
      name: args.name.trim(),
      tipoUbicacion: args.tipoUbicacion,
      tempMinC: args.tempMinC ?? null,
      tempMaxC: args.tempMaxC ?? null,
      capacidadMax: args.capacidadMax ?? null,
      isActive: true,
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    location.addDomainEvent(new LocationCreated({
      locationId: id.value,
      warehouseId: args.warehouseId,
      tenantId: args.tenantId,
      code: args.code,
      name: args.name.trim(),
      tipoUbicacion: args.tipoUbicacion,
      tempMinC: args.tempMinC ?? null,
      tempMaxC: args.tempMaxC ?? null,
    }));
    return ok(location);
  }

  static reconstitute(args: {
    id: LocationId;
    tenantId: string;
    warehouseId: WarehouseId;
    code: string;
    name: string;
    tipoUbicacion: TipoUbicacion;
    tempMinC: number | null;
    tempMaxC: number | null;
    capacidadMax: number | null;
    isActive: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Location {
    return new Location(args.id, {
      tenantId: args.tenantId,
      warehouseId: args.warehouseId,
      code: args.code,
      name: args.name,
      tipoUbicacion: args.tipoUbicacion,
      tempMinC: args.tempMinC,
      tempMaxC: args.tempMaxC,
      capacidadMax: args.capacidadMax,
      isActive: args.isActive,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}
