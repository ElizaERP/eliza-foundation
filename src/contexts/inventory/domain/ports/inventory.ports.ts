import { Lote } from '../lote';
import { Existencia } from '../existencia';
import { MovimientoInventario, TipoMovimiento } from '../movimiento-inventario';
import { Warehouse, Location } from '../warehouse';
import {
  LoteId,
  ExistenciaId,
  WarehouseId,
  LocationId,
  MovimientoId,
} from '../value-objects';

// =====================================================================
// Tokens de DI (para inyectar puertos sin clases concretas)
// =====================================================================
export const LOTE_REPOSITORY = Symbol('LoteRepository');
export const EXISTENCIA_REPOSITORY = Symbol('ExistenciaRepository');
export const MOVIMIENTO_REPOSITORY = Symbol('MovimientoRepository');
export const WAREHOUSE_REPOSITORY = Symbol('WarehouseRepository');
export const LOCATION_REPOSITORY = Symbol('LocationRepository');

// =====================================================================
// LoteRepository
// =====================================================================
export interface LoteRepository {
  findById(id: LoteId): Promise<Lote | null>;
  findByCodigoLote(productId: string, codigoLote: string): Promise<Lote | null>;
  findExpiringBefore(date: Date, limit: number): Promise<Lote[]>;
  findByProduct(productId: string, limit: number, offset: number): Promise<Lote[]>;
  /** Persiste con optimistic concurrency. Lanza 412 si la versión no coincide. */
  save(lote: Lote): Promise<void>;
}

// =====================================================================
// ExistenciaRepository
// =====================================================================
export interface ExistenciaStockFilter {
  productId?: string;
  loteId?: string;
  locationId?: string;
  minDisponible?: number;
  conReservas?: boolean;
}

export interface ExistenciaRepository {
  findById(id: ExistenciaId): Promise<Existencia | null>;

  /** Busca la existencia para (product, lote, location). Si no existe devuelve null. */
  findByCompositeKey(
    productId: string,
    loteId: string,
    locationId: string,
  ): Promise<Existencia | null>;

  /**
   * Lista existencias por SKU ordenadas por fecha de vencimiento del lote ASC.
   * Solo retorna existencias con cantidadDisponible > 0 y lote reservable.
   * Es el core de la política FEFO.
   */
  findBySkuOrderedByExpiry(
    productId: string,
    onlyReservable: boolean,
  ): Promise<Existencia[]>;

  /** Todas las existencias activas de un SKU (incluye lotes bloqueados). */
  findBySku(productId: string): Promise<Existencia[]>;

  query(filter: ExistenciaStockFilter): Promise<Existencia[]>;

  save(existencia: Existencia): Promise<void>;
}

// =====================================================================
// MovimientoRepository (append-only)
// =====================================================================
export interface MovimientoQueryFilter {
  productId?: string;
  loteId?: string;
  locationId?: string;
  tipo?: TipoMovimiento;
  ocurridoDesde?: Date;
  ocurridoHasta?: Date;
  referenciaId?: string;
  limit: number;
  offset: number;
}

export interface MovimientoRepository {
  findById(id: MovimientoId): Promise<MovimientoInventario | null>;
  query(filter: MovimientoQueryFilter): Promise<MovimientoInventario[]>;
  countBy(filter: MovimientoQueryFilter): Promise<number>;
  /** Append-only: solo crea, nunca actualiza. */
  append(movimiento: MovimientoInventario): Promise<void>;
}

// =====================================================================
// WarehouseRepository / LocationRepository
// =====================================================================
export interface WarehouseRepository {
  findById(id: WarehouseId): Promise<Warehouse | null>;
  findByCode(code: string): Promise<Warehouse | null>;
  list(activeOnly: boolean): Promise<Warehouse[]>;
  save(warehouse: Warehouse): Promise<void>;
}

export interface LocationRepository {
  findById(id: LocationId): Promise<Location | null>;
  findByCode(warehouseId: string, code: string): Promise<Location | null>;
  listByWarehouse(warehouseId: string, activeOnly: boolean): Promise<Location[]>;
  save(location: Location): Promise<void>;
}
