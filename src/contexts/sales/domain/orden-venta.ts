import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  OrderCancelled,
  OrderConfirmed,
  OrderDispatched,
  OrderDrafted,
  OrderReserved,
} from './sales-events';
import {
  CodigoPedido,
  CondicionesPago,
  DireccionEntrega,
  EstadoOrdenVenta,
  LineaPedidoId,
  OrdenVentaId,
  PrecioUnitario,
} from './value-objects';

// =====================================================================
// Valid state transitions
// =====================================================================

const VALID_TRANSITIONS: Record<EstadoOrdenVenta, EstadoOrdenVenta[]> = {
  [EstadoOrdenVenta.Borrador]: [EstadoOrdenVenta.Confirmada, EstadoOrdenVenta.Cancelada],
  [EstadoOrdenVenta.Confirmada]: [EstadoOrdenVenta.Reservada, EstadoOrdenVenta.Cancelada],
  [EstadoOrdenVenta.Reservada]: [EstadoOrdenVenta.Despachada, EstadoOrdenVenta.Cancelada],
  [EstadoOrdenVenta.Despachada]: [EstadoOrdenVenta.Cerrada],
  [EstadoOrdenVenta.Cerrada]: [],
  [EstadoOrdenVenta.Cancelada]: [],
};

// =====================================================================
// LineaPedido — entidad anidada
// =====================================================================

export interface LineaPedidoProps {
  id: LineaPedidoId;
  productId: string;
  productCode: string;
  productName: string;
  cantidad: number;
  precioUnitario: PrecioUnitario;
  tasaIva: number;
  subtotal: number;
  iva: number;
  total: number;
  notas: string | null;
}

export class LineaPedido {
  private constructor(private readonly _props: LineaPedidoProps) {}

  get id(): LineaPedidoId { return this._props.id; }
  get productId(): string { return this._props.productId; }
  get productCode(): string { return this._props.productCode; }
  get productName(): string { return this._props.productName; }
  get cantidad(): number { return this._props.cantidad; }
  get precioUnitario(): number { return this._props.precioUnitario.amount; }
  get tasaIva(): number { return this._props.tasaIva; }
  get subtotal(): number { return this._props.subtotal; }
  get iva(): number { return this._props.iva; }
  get total(): number { return this._props.total; }
  get notas(): string | null { return this._props.notas; }

  static create(args: {
    productId: string;
    productCode: string;
    productName: string;
    cantidad: number;
    precioUnitario: number;
    tasaIva: number;
    notas?: string;
  }): Result<LineaPedido, DomainError> {
    if (args.cantidad <= 0) {
      return err({ code: 'linea.cantidad_invalid', message: 'Quantity must be positive' });
    }

    const precioR = PrecioUnitario.create(args.precioUnitario);
    if (precioR.isErr) return err(precioR.error);

    if (args.tasaIva < 0 || args.tasaIva > 100) {
      return err({ code: 'linea.tasa_iva_invalid', message: 'IVA rate must be between 0 and 100' });
    }

    const subtotal = Math.round(args.cantidad * precioR.value.amount * 100) / 100;
    const iva = Math.round(subtotal * (args.tasaIva / 100) * 100) / 100;
    const total = Math.round((subtotal + iva) * 100) / 100;

    return ok(new LineaPedido({
      id: LineaPedidoId.generate(),
      productId: args.productId,
      productCode: args.productCode,
      productName: args.productName,
      cantidad: args.cantidad,
      precioUnitario: precioR.value,
      tasaIva: args.tasaIva,
      subtotal,
      iva,
      total,
      notas: args.notas?.trim() || null,
    }));
  }

  static reconstitute(props: LineaPedidoProps): LineaPedido {
    return new LineaPedido(props);
  }
}

// =====================================================================
// OrdenDeVenta — Aggregate Root
// =====================================================================

interface OrdenVentaProps {
  tenantId: string;
  codigo: CodigoPedido;
  clienteId: string;
  clienteCodigo: string;
  clienteRazonSocial: string;
  estado: EstadoOrdenVenta;
  condicionesPago: CondicionesPago;
  direccionEntrega: DireccionEntrega;
  lineas: LineaPedido[];
  subtotal: number;
  ivaTotal: number;
  total: number;
  notas: string | null;
  canceladoMotivo: string | null;
  canceladoPor: string | null;
  canceladoEn: Date | null;
  confirmadoEn: Date | null;
  reservadoEn: Date | null;
  despachadoEn: Date | null;
  cerradoEn: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OrdenDeVenta — Aggregate Root.
 *
 * Modela el ciclo de vida de un pedido de venta de congelados.
 *
 * Invariantes:
 *   1. Solo se pueden agregar/quitar líneas en estado Borrador.
 *   2. Debe tener al menos una línea para poder confirmarse.
 *   3. No se puede confirmar si el cliente está Suspendido.
 *   4. Solo se puede reservar desde Confirmada.
 *   5. Solo se puede despachar desde Reservada.
 *   6. Solo se puede cerrar desde Despachada.
 *   7. Se puede cancelar desde Borrador, Confirmada o Reservada.
 *   8. Los totales se recalculan automáticamente al agregar/quitar líneas.
 *   9. codigo es único por tenant (lo valida el use case).
 *  10. Un producto no puede repetirse en dos líneas distintas.
 */
export class OrdenDeVenta extends AggregateRoot<OrdenVentaId, OrdenVentaProps> {
  private constructor(id: OrdenVentaId, props: OrdenVentaProps, version: number) {
    super(id, props, version);
  }

  // ---------- Getters ----------
  get tenantId(): string { return this.props.tenantId; }
  get codigo(): string { return this.props.codigo.value; }
  get clienteId(): string { return this.props.clienteId; }
  get clienteCodigo(): string { return this.props.clienteCodigo; }
  get clienteRazonSocial(): string { return this.props.clienteRazonSocial; }
  get estado(): EstadoOrdenVenta { return this.props.estado; }
  get condicionesPago(): CondicionesPago { return this.props.condicionesPago; }
  get direccionEntrega(): DireccionEntrega { return this.props.direccionEntrega; }
  get lineas(): ReadonlyArray<LineaPedido> { return this.props.lineas; }
  get subtotal(): number { return this.props.subtotal; }
  get ivaTotal(): number { return this.props.ivaTotal; }
  get total(): number { return this.props.total; }
  get notas(): string | null { return this.props.notas; }
  get canceladoMotivo(): string | null { return this.props.canceladoMotivo; }
  get canceladoPor(): string | null { return this.props.canceladoPor; }
  get canceladoEn(): Date | null { return this.props.canceladoEn; }
  get confirmadoEn(): Date | null { return this.props.confirmadoEn; }
  get reservadoEn(): Date | null { return this.props.reservadoEn; }
  get despachadoEn(): Date | null { return this.props.despachadoEn; }
  get cerradoEn(): Date | null { return this.props.cerradoEn; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Referencia que usa Inventory para las reservas de esta orden. */
  get referenciaInventario(): string { return this._id.value; }

  // ---------- Factory ----------

  static create(args: {
    tenantId: string;
    codigo: string;
    clienteId: string;
    clienteCodigo: string;
    clienteRazonSocial: string;
    condicionesPago: CondicionesPago;
    direccionEntrega: {
      direccion: string;
      ciudad: string;
      departamento: string;
      telefono?: string;
      notas?: string;
    };
    notas?: string;
    now: Date;
  }): Result<OrdenDeVenta, DomainError> {
    const codigoR = CodigoPedido.create(args.codigo);
    if (codigoR.isErr) return err(codigoR.error);

    const dirR = DireccionEntrega.create(args.direccionEntrega);
    if (dirR.isErr) return err(dirR.error);

    const id = OrdenVentaId.generate();
    const orden = new OrdenDeVenta(id, {
      tenantId: args.tenantId,
      codigo: codigoR.value,
      clienteId: args.clienteId,
      clienteCodigo: args.clienteCodigo,
      clienteRazonSocial: args.clienteRazonSocial,
      estado: EstadoOrdenVenta.Borrador,
      condicionesPago: args.condicionesPago,
      direccionEntrega: dirR.value,
      lineas: [],
      subtotal: 0,
      ivaTotal: 0,
      total: 0,
      notas: args.notas?.trim() || null,
      canceladoMotivo: null,
      canceladoPor: null,
      canceladoEn: null,
      confirmadoEn: null,
      reservadoEn: null,
      despachadoEn: null,
      cerradoEn: null,
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    orden.addDomainEvent(new OrderDrafted({
      ordenId: id.value,
      tenantId: args.tenantId,
      codigo: codigoR.value.value,
      clienteId: args.clienteId,
      clienteCodigo: args.clienteCodigo,
    }));

    return ok(orden);
  }

  // ---------- Line management (solo en Borrador) ----------

  addLine(args: {
    productId: string;
    productCode: string;
    productName: string;
    cantidad: number;
    precioUnitario: number;
    tasaIva: number;
    notas?: string;
    now: Date;
  }): Result<LineaPedido, DomainError> {
    if (this.props.estado !== EstadoOrdenVenta.Borrador) {
      return err({ code: 'orden.not_borrador',
        message: `Cannot modify lines in state ${this.props.estado}` });
    }

    // Invariante: no repetir producto en dos líneas
    const exists = this.props.lineas.find((l) => l.productId === args.productId);
    if (exists) {
      return err({ code: 'orden.product_already_in_order',
        message: `Product ${args.productCode} is already in this order (line ${exists.id.value})` });
    }

    const lineaR = LineaPedido.create({
      productId: args.productId,
      productCode: args.productCode,
      productName: args.productName,
      cantidad: args.cantidad,
      precioUnitario: args.precioUnitario,
      tasaIva: args.tasaIva,
      notas: args.notas,
    });
    if (lineaR.isErr) return err(lineaR.error);

    this.props = {
      ...this.props,
      lineas: [...this.props.lineas, lineaR.value],
      updatedAt: args.now,
    };
    this.recalcularTotales();
    this.incrementVersion();

    return ok(lineaR.value);
  }

  removeLine(args: { lineaId: string; now: Date }): Result<void, DomainError> {
    if (this.props.estado !== EstadoOrdenVenta.Borrador) {
      return err({ code: 'orden.not_borrador',
        message: `Cannot modify lines in state ${this.props.estado}` });
    }

    const idx = this.props.lineas.findIndex((l) => l.id.value === args.lineaId);
    if (idx === -1) {
      return err({ code: 'orden.linea_not_found',
        message: `Line ${args.lineaId} not found in this order` });
    }

    this.props = {
      ...this.props,
      lineas: this.props.lineas.filter((_, i) => i !== idx),
      updatedAt: args.now,
    };
    this.recalcularTotales();
    this.incrementVersion();

    return ok(undefined);
  }

  // ---------- State transitions ----------

  /** Confirma el pedido. Cierra las líneas y prepara para reserva FEFO. */
  confirm(args: { now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenVenta.Confirmada)) {
      return err({ code: 'orden.invalid_transition',
        message: `Cannot confirm from state ${this.props.estado}` });
    }
    if (this.props.lineas.length === 0) {
      return err({ code: 'orden.no_lines',
        message: 'Cannot confirm an order with no lines' });
    }

    this.props = {
      ...this.props,
      estado: EstadoOrdenVenta.Confirmada,
      confirmadoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new OrderConfirmed({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      codigo: this.props.codigo.value,
      clienteId: this.props.clienteId,
      lineasCount: this.props.lineas.length,
      totalBruto: this.props.total,
    }));

    return ok(undefined);
  }

  /** Marca que el stock fue reservado exitosamente vía FEFO. */
  markReserved(args: { now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenVenta.Reservada)) {
      return err({ code: 'orden.invalid_transition',
        message: `Cannot mark as reserved from state ${this.props.estado}` });
    }

    this.props = {
      ...this.props,
      estado: EstadoOrdenVenta.Reservada,
      reservadoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new OrderReserved({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      codigo: this.props.codigo.value,
      lineasReservadas: this.props.lineas.length,
    }));

    return ok(undefined);
  }

  /** Marca que el stock fue despachado del inventario. */
  markDispatched(args: { movimientoIds: string[]; now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenVenta.Despachada)) {
      return err({ code: 'orden.invalid_transition',
        message: `Cannot dispatch from state ${this.props.estado}` });
    }

    this.props = {
      ...this.props,
      estado: EstadoOrdenVenta.Despachada,
      despachadoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new OrderDispatched({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      codigo: this.props.codigo.value,
      clienteId: this.props.clienteId,
      totalDespachado: this.props.lineas.reduce((sum, l) => sum + l.cantidad, 0),
      movimientoIds: args.movimientoIds,
    }));

    return ok(undefined);
  }

  /** Cierra el pedido (archivado, solo desde Despachada). */
  close(args: { now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenVenta.Cerrada)) {
      return err({ code: 'orden.invalid_transition',
        message: `Cannot close from state ${this.props.estado}` });
    }
    this.props = {
      ...this.props,
      estado: EstadoOrdenVenta.Cerrada,
      cerradoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();
    return ok(undefined);
  }

  /** Cancela el pedido. Motivo obligatorio. */
  cancel(args: {
    motivo: string;
    canceladoPor: string;
    reservasLiberadas: boolean;
    now: Date;
  }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenVenta.Cancelada)) {
      return err({ code: 'orden.cannot_cancel',
        message: `Cannot cancel from state ${this.props.estado}` });
    }
    if (!args.motivo || args.motivo.trim().length < 3) {
      return err({ code: 'orden.motivo_required',
        message: 'Cancellation requires a reason of at least 3 characters' });
    }

    this.props = {
      ...this.props,
      estado: EstadoOrdenVenta.Cancelada,
      canceladoMotivo: args.motivo.trim(),
      canceladoPor: args.canceladoPor,
      canceladoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new OrderCancelled({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      codigo: this.props.codigo.value,
      motivo: args.motivo.trim(),
      canceladoPor: args.canceladoPor,
      reservasLiberadas: args.reservasLiberadas,
    }));

    return ok(undefined);
  }

  // ---------- Private ----------

  private recalcularTotales(): void {
    const subtotal = this.props.lineas.reduce((sum, l) => sum + l.subtotal, 0);
    const ivaTotal = this.props.lineas.reduce((sum, l) => sum + l.iva, 0);
    this.props = {
      ...this.props,
      subtotal: Math.round(subtotal * 100) / 100,
      ivaTotal: Math.round(ivaTotal * 100) / 100,
      total: Math.round((subtotal + ivaTotal) * 100) / 100,
    };
  }

  // ---------- Reconstitution ----------

  static reconstitute(args: {
    id: OrdenVentaId;
    tenantId: string;
    codigo: CodigoPedido;
    clienteId: string;
    clienteCodigo: string;
    clienteRazonSocial: string;
    estado: EstadoOrdenVenta;
    condicionesPago: CondicionesPago;
    direccionEntrega: DireccionEntrega;
    lineas: LineaPedido[];
    subtotal: number;
    ivaTotal: number;
    total: number;
    notas: string | null;
    canceladoMotivo: string | null;
    canceladoPor: string | null;
    canceladoEn: Date | null;
    confirmadoEn: Date | null;
    reservadoEn: Date | null;
    despachadoEn: Date | null;
    cerradoEn: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): OrdenDeVenta {
    return new OrdenDeVenta(args.id, {
      tenantId: args.tenantId,
      codigo: args.codigo,
      clienteId: args.clienteId,
      clienteCodigo: args.clienteCodigo,
      clienteRazonSocial: args.clienteRazonSocial,
      estado: args.estado,
      condicionesPago: args.condicionesPago,
      direccionEntrega: args.direccionEntrega,
      lineas: args.lineas,
      subtotal: args.subtotal,
      ivaTotal: args.ivaTotal,
      total: args.total,
      notas: args.notas,
      canceladoMotivo: args.canceladoMotivo,
      canceladoPor: args.canceladoPor,
      canceladoEn: args.canceladoEn,
      confirmadoEn: args.confirmadoEn,
      reservadoEn: args.reservadoEn,
      despachadoEn: args.despachadoEn,
      cerradoEn: args.cerradoEn,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}