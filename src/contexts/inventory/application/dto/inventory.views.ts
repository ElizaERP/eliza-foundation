import {
  EstadoLote,
  EstadoReserva,
  Existencia,
  Location,
  Lote,
  MovimientoInventario,
  OrigenLote,
  Reserva,
  TipoMovimiento,
  TipoUbicacion,
  Warehouse,
} from '@eliza/contexts/inventory/domain';

// =====================================================================
// LoteView
// =====================================================================
export interface LoteView {
  id: string;
  codigoLote: string;
  productId: string;
  fechaProduccion: string;
  fechaVencimiento: string;
  cantidadInicial: number;
  estado: EstadoLote;
  origenTipo: OrigenLote;
  origenRef: string | null;
  bloqueadoMotivo: string | null;
  bloqueadoPor: string | null;
  bloqueadoEn: string | null;
  diasParaVencer: number;
  estaVencido: boolean;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toLoteView(l: Lote, now: Date = new Date()): LoteView {
  return {
    id: l.id.value,
    codigoLote: l.codigoLote,
    productId: l.productId,
    fechaProduccion: l.fechaProduccion.toISOString(),
    fechaVencimiento: l.fechaVencimiento.iso,
    cantidadInicial: l.cantidadInicial,
    estado: l.estado,
    origenTipo: l.origenTipo,
    origenRef: l.origenRef,
    bloqueadoMotivo: l.bloqueadoMotivo,
    bloqueadoPor: l.bloqueadoPor,
    bloqueadoEn: l.bloqueadoEn?.toISOString() ?? null,
    diasParaVencer: l.fechaVencimiento.daysUntilExpiry(now),
    estaVencido: l.fechaVencimiento.isExpired(now),
    notas: l.notas,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

// =====================================================================
// ReservaView / ExistenciaView
// =====================================================================
export interface ReservaView {
  id: string;
  referenciaTipo: string;
  referenciaId: string;
  cantidad: number;
  estado: EstadoReserva;
  createdAt: string;
  releasedAt: string | null;
  releasedReason: string | null;
}

export function toReservaView(r: Reserva): ReservaView {
  return {
    id: r.id.value,
    referenciaTipo: r.referencia.tipo,
    referenciaId: r.referencia.id,
    cantidad: r.cantidad.amount,
    estado: r.estado,
    createdAt: r.createdAt.toISOString(),
    releasedAt: r.releasedAt?.toISOString() ?? null,
    releasedReason: r.releasedReason,
  };
}

export interface ExistenciaView {
  id: string;
  productId: string;
  loteId: string;
  locationId: string;
  cantidadDisponible: number;
  cantidadReservada: number;
  cantidadBloqueada: number;
  cantidadTotal: number;
  reservas: ReservaView[];
  createdAt: string;
  updatedAt: string;
}

export function toExistenciaView(e: Existencia): ExistenciaView {
  return {
    id: e.id.value,
    productId: e.productId,
    loteId: e.loteId.value,
    locationId: e.locationId.value,
    cantidadDisponible: e.cantidadDisponible.amount,
    cantidadReservada: e.cantidadReservada.amount,
    cantidadBloqueada: e.cantidadBloqueada.amount,
    cantidadTotal: e.cantidadTotal,
    reservas: e.reservas.filter((r) => r.isActive()).map(toReservaView),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// =====================================================================
// StockSummaryView — agregado por SKU (lo que pide GetStockBySku)
// =====================================================================
export interface StockByLotView {
  loteId: string;
  codigoLote: string;
  fechaVencimiento: string;
  estado: EstadoLote;
  /** Estado Disponible y sin vencer: la reserva FEFO puede tomar de este lote. */
  reservable: boolean;
  cantidadDisponible: number;
  cantidadReservada: number;
  cantidadBloqueada: number;
  ubicaciones: Array<{
    /** Para ajustar esta existencia (POST /inventory/stock/adjust/:existenciaId). */
    existenciaId: string;
    locationId: string;
    cantidadDisponible: number;
    cantidadReservada: number;
    cantidadBloqueada: number;
  }>;
}

export interface StockSummaryView {
  productId: string;
  /** Solo lo reservable (lotes Disponibles sin vencer). */
  totalDisponible: number;
  /** Bloqueado en existencias + disponible de lotes no reservables. */
  totalReservado: number;
  totalBloqueado: number;
  totalFisico: number;
  porLote: StockByLotView[];
}

// =====================================================================
// MovimientoView
// =====================================================================
export interface MovimientoView {
  id: string;
  tipo: TipoMovimiento;
  productId: string;
  loteId: string | null;
  locationId: string;
  locationDestinoId: string | null;
  cantidad: number;
  referenciaTipo: string;
  referenciaId: string;
  motivo: string | null;
  ocurridoEn: string;
  registradoPor: string;
  createdAt: string;
}

export function toMovimientoView(m: MovimientoInventario): MovimientoView {
  return {
    id: m.id.value,
    tipo: m.tipo,
    productId: m.productId,
    loteId: m.loteId?.value ?? null,
    locationId: m.locationId.value,
    locationDestinoId: m.locationDestinoId?.value ?? null,
    cantidad: m.cantidad.amount,
    referenciaTipo: m.referencia.tipo,
    referenciaId: m.referencia.id,
    motivo: m.motivo,
    ocurridoEn: m.ocurridoEn.toISOString(),
    registradoPor: m.registradoPor,
    createdAt: m.createdAt.toISOString(),
  };
}

// =====================================================================
// Warehouse / Location views
// =====================================================================
export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toWarehouseView(w: Warehouse): WarehouseView {
  return {
    id: w.id.value,
    code: w.code,
    name: w.name,
    address: w.address,
    isActive: w.isActive,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export interface LocationView {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  tipoUbicacion: TipoUbicacion;
  tempMinC: number | null;
  tempMaxC: number | null;
  capacidadMax: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toLocationView(l: Location): LocationView {
  return {
    id: l.id.value,
    warehouseId: l.warehouseId.value,
    code: l.code,
    name: l.name,
    tipoUbicacion: l.tipoUbicacion,
    tempMinC: l.tempMinC,
    tempMaxC: l.tempMaxC,
    capacidadMax: l.capacidadMax,
    isActive: l.isActive,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}
