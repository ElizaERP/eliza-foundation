import {
  ComponenteBomSnapshot,
  ConsumoMp,
  EstadoOrdenProduccion,
  LoteProducido,
  OrdenDeProduccion,
  PrioridadProduccion,
} from '@eliza/contexts/manufacturing/domain';

// =====================================================================
// ConsumoMpView
// =====================================================================
export interface ConsumoMpView {
  id: string;
  productId: string;
  productCode: string;
  loteId: string;
  codigoLote: string;
  cantidad: number;
  unidadMedida: string;
  movimientoId: string;
  consumidoEn: string;
}

export function toConsumoMpView(c: ConsumoMp): ConsumoMpView {
  return {
    id: c.id.value,
    productId: c.productId,
    productCode: c.productCode,
    loteId: c.loteId,
    codigoLote: c.codigoLote,
    cantidad: c.cantidad,
    unidadMedida: c.unidadMedida,
    movimientoId: c.movimientoId,
    consumidoEn: c.consumidoEn.toISOString(),
  };
}

// =====================================================================
// LoteProducidoView
// =====================================================================
export interface LoteProducidoView {
  id: string;
  loteId: string;
  codigoLote: string;
  productId: string;
  cantidad: number;
  locationId: string;
  movimientoId: string;
  producidoEn: string;
}

export function toLoteProducidoView(lp: LoteProducido): LoteProducidoView {
  return {
    id: lp.id.value,
    loteId: lp.loteId,
    codigoLote: lp.codigoLote,
    productId: lp.productId,
    cantidad: lp.cantidad,
    locationId: lp.locationId,
    movimientoId: lp.movimientoId,
    producidoEn: lp.producidoEn.toISOString(),
  };
}

// =====================================================================
// OrdenProduccionView
// =====================================================================
export interface OrdenProduccionView {
  id: string;
  codigo: string;
  productoTerminado: {
    id: string;
    code: string;
    name: string;
  };
  cantidadObjetivo: number;
  cantidadRealProducida: number;
  estado: EstadoOrdenProduccion;
  prioridad: PrioridadProduccion;
  componentes: ComponenteBomSnapshot[];
  materialesReservados: boolean;
  consumos: ConsumoMpView[];
  lotesProducidos: LoteProducidoView[];
  notas: string | null;
  canceladoMotivo: string | null;
  canceladoPor: string | null;
  canceladoEn: string | null;
  fechaProgramada: string | null;
  iniciadoEn: string | null;
  completadoEn: string | null;
  cerradoEn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toOrdenProduccionView(o: OrdenDeProduccion): OrdenProduccionView {
  return {
    id: o.id.value,
    codigo: o.codigo,
    productoTerminado: {
      id: o.productoTerminadoId,
      code: o.productoTerminadoCode,
      name: o.productoTerminadoName,
    },
    cantidadObjetivo: o.cantidadObjetivo,
    cantidadRealProducida: o.cantidadRealProducida,
    estado: o.estado,
    prioridad: o.prioridad,
    componentes: [...o.componentes],
    materialesReservados: o.materialesReservados,
    consumos: o.consumos.map(toConsumoMpView),
    lotesProducidos: o.lotesProducidos.map(toLoteProducidoView),
    notas: o.notas,
    canceladoMotivo: o.canceladoMotivo,
    canceladoPor: o.canceladoPor,
    canceladoEn: o.canceladoEn?.toISOString() ?? null,
    fechaProgramada: o.fechaProgramada?.toISOString() ?? null,
    iniciadoEn: o.iniciadoEn?.toISOString() ?? null,
    completadoEn: o.completadoEn?.toISOString() ?? null,
    cerradoEn: o.cerradoEn?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

// =====================================================================
// OrdenProduccionListView — versión ligera para listados
// =====================================================================
export interface OrdenProduccionListView {
  id: string;
  codigo: string;
  productoTerminadoCode: string;
  productoTerminadoName: string;
  cantidadObjetivo: number;
  cantidadRealProducida: number;
  estado: EstadoOrdenProduccion;
  prioridad: PrioridadProduccion;
  materialesReservados: boolean;
  consumosCount: number;
  lotesProducidosCount: number;
  fechaProgramada: string | null;
  createdAt: string;
}

export function toOrdenProduccionListView(o: OrdenDeProduccion): OrdenProduccionListView {
  return {
    id: o.id.value,
    codigo: o.codigo,
    productoTerminadoCode: o.productoTerminadoCode,
    productoTerminadoName: o.productoTerminadoName,
    cantidadObjetivo: o.cantidadObjetivo,
    cantidadRealProducida: o.cantidadRealProducida,
    estado: o.estado,
    prioridad: o.prioridad,
    materialesReservados: o.materialesReservados,
    consumosCount: o.consumos.length,
    lotesProducidosCount: o.lotesProducidos.length,
    fechaProgramada: o.fechaProgramada?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}