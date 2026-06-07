import {
  Cliente,
  CondicionesPago,
  DireccionEntrega,
  EstadoCliente,
  EstadoOrdenVenta,
  LineaPedido,
  OrdenDeVenta,
} from '@eliza/contexts/sales/domain';

// =====================================================================
// DireccionView
// =====================================================================
export interface DireccionView {
  direccion: string;
  ciudad: string;
  departamento: string;
  telefono: string | null;
  notas: string | null;
}

function toDireccionView(d: DireccionEntrega): DireccionView {
  return {
    direccion: d.direccion,
    ciudad: d.ciudad,
    departamento: d.departamento,
    telefono: d.telefono,
    notas: d.notas,
  };
}

// =====================================================================
// ClienteView
// =====================================================================
export interface ClienteView {
  id: string;
  codigo: string;
  nit: string;
  razonSocial: string;
  nombreComercial: string | null;
  estado: EstadoCliente;
  condicionesPago: CondicionesPago;
  direccionFiscal: DireccionView;
  direccionEntrega: DireccionView | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  contactoEmail: string | null;
  notas: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toClienteView(c: Cliente): ClienteView {
  return {
    id: c.id.value,
    codigo: c.codigo,
    nit: c.nit,
    razonSocial: c.razonSocial,
    nombreComercial: c.nombreComercial,
    estado: c.estado,
    condicionesPago: c.condicionesPago,
    direccionFiscal: toDireccionView(c.direccionFiscal),
    direccionEntrega: c.direccionEntrega ? toDireccionView(c.direccionEntrega) : null,
    contactoNombre: c.contactoNombre,
    contactoTelefono: c.contactoTelefono,
    contactoEmail: c.contactoEmail,
    notas: c.notas,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// =====================================================================
// ClienteListView — versión ligera para listados
// =====================================================================
export interface ClienteListView {
  id: string;
  codigo: string;
  nit: string;
  razonSocial: string;
  nombreComercial: string | null;
  estado: EstadoCliente;
  condicionesPago: CondicionesPago;
  ciudad: string;
  createdAt: string;
}

export function toClienteListView(c: Cliente): ClienteListView {
  return {
    id: c.id.value,
    codigo: c.codigo,
    nit: c.nit,
    razonSocial: c.razonSocial,
    nombreComercial: c.nombreComercial,
    estado: c.estado,
    condicionesPago: c.condicionesPago,
    ciudad: c.direccionFiscal.ciudad,
    createdAt: c.createdAt.toISOString(),
  };
}

// =====================================================================
// LineaPedidoView
// =====================================================================
export interface LineaPedidoView {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  cantidad: number;
  precioUnitario: number;
  tasaIva: number;
  subtotal: number;
  iva: number;
  total: number;
  notas: string | null;
}

export function toLineaPedidoView(l: LineaPedido): LineaPedidoView {
  return {
    id: l.id.value,
    productId: l.productId,
    productCode: l.productCode,
    productName: l.productName,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario,
    tasaIva: l.tasaIva,
    subtotal: l.subtotal,
    iva: l.iva,
    total: l.total,
    notas: l.notas,
  };
}

// =====================================================================
// OrdenVentaView
// =====================================================================
export interface OrdenVentaView {
  id: string;
  codigo: string;
  cliente: {
    id: string;
    codigo: string;
    razonSocial: string;
  };
  estado: EstadoOrdenVenta;
  condicionesPago: CondicionesPago;
  direccionEntrega: DireccionView;
  lineas: LineaPedidoView[];
  subtotal: number;
  ivaTotal: number;
  total: number;
  notas: string | null;
  canceladoMotivo: string | null;
  canceladoPor: string | null;
  canceladoEn: string | null;
  confirmadoEn: string | null;
  reservadoEn: string | null;
  despachadoEn: string | null;
  cerradoEn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toOrdenVentaView(o: OrdenDeVenta): OrdenVentaView {
  return {
    id: o.id.value,
    codigo: o.codigo,
    cliente: {
      id: o.clienteId,
      codigo: o.clienteCodigo,
      razonSocial: o.clienteRazonSocial,
    },
    estado: o.estado,
    condicionesPago: o.condicionesPago,
    direccionEntrega: toDireccionView(o.direccionEntrega),
    lineas: o.lineas.map(toLineaPedidoView),
    subtotal: o.subtotal,
    ivaTotal: o.ivaTotal,
    total: o.total,
    notas: o.notas,
    canceladoMotivo: o.canceladoMotivo,
    canceladoPor: o.canceladoPor,
    canceladoEn: o.canceladoEn?.toISOString() ?? null,
    confirmadoEn: o.confirmadoEn?.toISOString() ?? null,
    reservadoEn: o.reservadoEn?.toISOString() ?? null,
    despachadoEn: o.despachadoEn?.toISOString() ?? null,
    cerradoEn: o.cerradoEn?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

// =====================================================================
// OrdenVentaListView — versión ligera para listados
// =====================================================================
export interface OrdenVentaListView {
  id: string;
  codigo: string;
  clienteCodigo: string;
  clienteRazonSocial: string;
  estado: EstadoOrdenVenta;
  lineasCount: number;
  total: number;
  confirmadoEn: string | null;
  createdAt: string;
}

export function toOrdenVentaListView(o: OrdenDeVenta): OrdenVentaListView {
  return {
    id: o.id.value,
    codigo: o.codigo,
    clienteCodigo: o.clienteCodigo,
    clienteRazonSocial: o.clienteRazonSocial,
    estado: o.estado,
    lineasCount: o.lineas.length,
    total: o.total,
    confirmadoEn: o.confirmadoEn?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}