import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  LotProduced,
  MaterialsConsumed,
  MaterialsReserved,
  ProductionCancelled,
  ProductionCompleted,
  ProductionOrderCreated,
  ProductionStarted,
} from './manufacturing-events';
import {
  CantidadObjetivo,
  CodigoOrdenProduccion,
  ComponenteBomSnapshot,
  ConsumoMpId,
  EstadoOrdenProduccion,
  LoteProducidoId,
  OrdenProduccionId,
  PrioridadProduccion,
} from './value-objects';

// =====================================================================
// Valid state transitions
// =====================================================================

const VALID_TRANSITIONS: Record<EstadoOrdenProduccion, EstadoOrdenProduccion[]> = {
  [EstadoOrdenProduccion.Planificada]: [EstadoOrdenProduccion.EnProceso, EstadoOrdenProduccion.Cancelada],
  [EstadoOrdenProduccion.EnProceso]: [EstadoOrdenProduccion.Completada, EstadoOrdenProduccion.Cancelada],
  [EstadoOrdenProduccion.Completada]: [EstadoOrdenProduccion.Cerrada],
  [EstadoOrdenProduccion.Cerrada]: [],
  [EstadoOrdenProduccion.Cancelada]: [],
};

// =====================================================================
// ConsumoMP — entidad anidada (MP despachada del inventario)
// =====================================================================

export interface ConsumoMpProps {
  id: ConsumoMpId;
  productId: string;
  productCode: string;
  loteId: string;
  codigoLote: string;
  cantidad: number;
  unidadMedida: string;
  movimientoId: string;
  consumidoEn: Date;
}

export class ConsumoMp {
  private constructor(private readonly _props: ConsumoMpProps) {}

  get id(): ConsumoMpId { return this._props.id; }
  get productId(): string { return this._props.productId; }
  get productCode(): string { return this._props.productCode; }
  get loteId(): string { return this._props.loteId; }
  get codigoLote(): string { return this._props.codigoLote; }
  get cantidad(): number { return this._props.cantidad; }
  get unidadMedida(): string { return this._props.unidadMedida; }
  get movimientoId(): string { return this._props.movimientoId; }
  get consumidoEn(): Date { return this._props.consumidoEn; }

  static create(props: Omit<ConsumoMpProps, 'id'>): ConsumoMp {
    return new ConsumoMp({ id: ConsumoMpId.generate(), ...props });
  }

  static reconstitute(props: ConsumoMpProps): ConsumoMp {
    return new ConsumoMp(props);
  }
}

// =====================================================================
// LoteProducido — entidad anidada (PT registrado en inventario)
// =====================================================================

export interface LoteProducidoProps {
  id: LoteProducidoId;
  loteId: string;
  codigoLote: string;
  productId: string;
  cantidad: number;
  locationId: string;
  movimientoId: string;
  producidoEn: Date;
}

export class LoteProducido {
  private constructor(private readonly _props: LoteProducidoProps) {}

  get id(): LoteProducidoId { return this._props.id; }
  get loteId(): string { return this._props.loteId; }
  get codigoLote(): string { return this._props.codigoLote; }
  get productId(): string { return this._props.productId; }
  get cantidad(): number { return this._props.cantidad; }
  get locationId(): string { return this._props.locationId; }
  get movimientoId(): string { return this._props.movimientoId; }
  get producidoEn(): Date { return this._props.producidoEn; }

  static create(props: Omit<LoteProducidoProps, 'id'>): LoteProducido {
    return new LoteProducido({ id: LoteProducidoId.generate(), ...props });
  }

  static reconstitute(props: LoteProducidoProps): LoteProducido {
    return new LoteProducido(props);
  }
}

// =====================================================================
// OrdenDeProduccion — Aggregate Root
// =====================================================================

interface OrdenProduccionProps {
  tenantId: string;
  codigo: CodigoOrdenProduccion;
  productoTerminadoId: string;
  productoTerminadoCode: string;
  productoTerminadoName: string;
  cantidadObjetivo: CantidadObjetivo;
  estado: EstadoOrdenProduccion;
  prioridad: PrioridadProduccion;
  /** BOM snapshot — inmutable después de la creación */
  componentes: ComponenteBomSnapshot[];
  /** Indica si se reservó MP en Inventory (requisito para arrancar) */
  materialesReservados: boolean;
  consumos: ConsumoMp[];
  lotesProducidos: LoteProducido[];
  notas: string | null;
  /** Jornada de producción a la que pertenece (varias órdenes, un día de planta). null = orden suelta. */
  jornada: string | null;
  /** Quién canceló y por qué (solo si estado = Cancelada) */
  canceladoMotivo: string | null;
  canceladoPor: string | null;
  canceladoEn: Date | null;
  fechaProgramada: Date | null;
  iniciadoEn: Date | null;
  completadoEn: Date | null;
  cerradoEn: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OrdenDeProduccion — Aggregate Root.
 *
 * Modela el ciclo de vida completo de una orden de producción
 * de alimentos congelados (arepas, flautas).
 *
 * Invariantes:
 *   1. El BOM snapshot se captura al crear y NO se modifica.
 *   2. Solo se puede arrancar (EnProceso) si materialesReservados = true.
 *   3. Solo se puede registrar consumo/producción si está EnProceso.
 *   4. Solo se puede completar si hay al menos un LoteProducido.
 *   5. Solo se puede cancelar desde Planificada o EnProceso.
 *   6. Solo se puede cerrar desde Completada.
 *   7. cantidadObjetivo es inmutable — si necesitan otra cantidad,
 *      crean una orden nueva.
 *   8. codigo es único por tenant (lo valida el use case).
 */
export class OrdenDeProduccion extends AggregateRoot<OrdenProduccionId, OrdenProduccionProps> {
  private constructor(id: OrdenProduccionId, props: OrdenProduccionProps, version: number) {
    super(id, props, version);
  }

  // ---------- Getters ----------
  get tenantId(): string { return this.props.tenantId; }
  get codigo(): string { return this.props.codigo.value; }
  get productoTerminadoId(): string { return this.props.productoTerminadoId; }
  get productoTerminadoCode(): string { return this.props.productoTerminadoCode; }
  get productoTerminadoName(): string { return this.props.productoTerminadoName; }
  get cantidadObjetivo(): number { return this.props.cantidadObjetivo.amount; }
  get estado(): EstadoOrdenProduccion { return this.props.estado; }
  get prioridad(): PrioridadProduccion { return this.props.prioridad; }
  get componentes(): ReadonlyArray<ComponenteBomSnapshot> { return this.props.componentes; }
  get materialesReservados(): boolean { return this.props.materialesReservados; }
  get consumos(): ReadonlyArray<ConsumoMp> { return this.props.consumos; }
  get lotesProducidos(): ReadonlyArray<LoteProducido> { return this.props.lotesProducidos; }
  get notas(): string | null { return this.props.notas; }
  get jornada(): string | null { return this.props.jornada; }
  get canceladoMotivo(): string | null { return this.props.canceladoMotivo; }
  get canceladoPor(): string | null { return this.props.canceladoPor; }
  get canceladoEn(): Date | null { return this.props.canceladoEn; }
  get fechaProgramada(): Date | null { return this.props.fechaProgramada; }
  get iniciadoEn(): Date | null { return this.props.iniciadoEn; }
  get completadoEn(): Date | null { return this.props.completadoEn; }
  get cerradoEn(): Date | null { return this.props.cerradoEn; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Cantidad total ya producida (suma de lotesProducidos). */
  get cantidadRealProducida(): number {
    return this.props.lotesProducidos.reduce((sum, lp) => sum + lp.cantidad, 0);
  }

  /** Referencia que usa Inventory para las reservas de esta orden. */
  get referenciaInventario(): string { return this._id.value; }

  // ---------- Factory ----------

  static create(args: {
    tenantId: string;
    codigo: string;
    productoTerminadoId: string;
    productoTerminadoCode: string;
    productoTerminadoName: string;
    cantidadObjetivo: number;
    prioridad?: PrioridadProduccion;
    componentes: ComponenteBomSnapshot[];
    fechaProgramada?: Date;
    notas?: string;
    jornada?: string;
    now: Date;
  }): Result<OrdenDeProduccion, DomainError> {
    const codigoR = CodigoOrdenProduccion.create(args.codigo);
    if (codigoR.isErr) return err(codigoR.error);

    const cantR = CantidadObjetivo.create(args.cantidadObjetivo);
    if (cantR.isErr) return err(cantR.error);

    if (args.componentes.length === 0) {
      return err({ code: 'orden.bom_empty',
        message: 'Production order requires at least one BOM component' });
    }

    const id = OrdenProduccionId.generate();
    const orden = new OrdenDeProduccion(id, {
      tenantId: args.tenantId,
      codigo: codigoR.value,
      productoTerminadoId: args.productoTerminadoId,
      productoTerminadoCode: args.productoTerminadoCode,
      productoTerminadoName: args.productoTerminadoName,
      cantidadObjetivo: cantR.value,
      estado: EstadoOrdenProduccion.Planificada,
      prioridad: args.prioridad ?? PrioridadProduccion.Media,
      componentes: args.componentes,
      materialesReservados: false,
      consumos: [],
      lotesProducidos: [],
      notas: args.notas?.trim() || null,
      jornada: args.jornada ?? null,
      canceladoMotivo: null,
      canceladoPor: null,
      canceladoEn: null,
      fechaProgramada: args.fechaProgramada ?? null,
      iniciadoEn: null,
      completadoEn: null,
      cerradoEn: null,
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    orden.addDomainEvent(new ProductionOrderCreated({
      ordenId: id.value,
      tenantId: args.tenantId,
      codigo: codigoR.value.value,
      productoTerminadoId: args.productoTerminadoId,
      cantidadObjetivo: cantR.value.amount,
      componentesCount: args.componentes.length,
      prioridad: args.prioridad ?? PrioridadProduccion.Media,
    }));

    return ok(orden);
  }

  // ---------- State transitions ----------

  /** Marca que los materiales fueron reservados en Inventory (FEFO). */
  markMaterialsReserved(args: { now: Date }): Result<void, DomainError> {
    if (this.props.estado !== EstadoOrdenProduccion.Planificada) {
      return err({ code: 'orden.invalid_state_for_reservation',
        message: `Cannot reserve materials in state ${this.props.estado}` });
    }
    if (this.props.materialesReservados) {
      return ok(undefined); // idempotente
    }
    this.props = { ...this.props, materialesReservados: true, updatedAt: args.now };
    this.incrementVersion();

    this.addDomainEvent(new MaterialsReserved({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      componentesReservados: this.props.componentes.length,
    }));
    return ok(undefined);
  }

  /**
   * Deshace la marca de materiales reservados (la jornada no pudo reservar todos
   * sus productos y devuelve lo apartado). Solo en Planificada; el use case
   * libera las reservas en Inventario.
   */
  releaseMaterials(args: { now: Date }): Result<void, DomainError> {
    if (this.props.estado !== EstadoOrdenProduccion.Planificada) {
      return err({ code: 'orden.invalid_state_for_reservation',
        message: `Cannot release materials in state ${this.props.estado}` });
    }
    if (!this.props.materialesReservados) return ok(undefined);
    this.props = { ...this.props, materialesReservados: false, updatedAt: args.now };
    this.incrementVersion();
    return ok(undefined);
  }

  /** Arranca la producción. Requiere materiales reservados. */
  start(args: { iniciadoPor: string; now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenProduccion.EnProceso)) {
      return err({ code: 'orden.invalid_transition',
        message: `Cannot start from state ${this.props.estado}` });
    }
    if (!this.props.materialesReservados) {
      return err({ code: 'orden.materials_not_reserved',
        message: 'Cannot start production without reserving materials first' });
    }

    this.props = {
      ...this.props,
      estado: EstadoOrdenProduccion.EnProceso,
      iniciadoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new ProductionStarted({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      iniciadoPor: args.iniciadoPor,
    }));
    return ok(undefined);
  }

  /** Registra el consumo de una MP (ya despachada del inventario). */
  recordConsumption(args: {
    productId: string;
    productCode: string;
    loteId: string;
    codigoLote: string;
    cantidad: number;
    unidadMedida: string;
    movimientoId: string;
    now: Date;
  }): Result<ConsumoMp, DomainError> {
    if (this.props.estado !== EstadoOrdenProduccion.EnProceso) {
      return err({ code: 'orden.must_be_en_proceso',
        message: `Cannot record consumption in state ${this.props.estado}` });
    }
    if (args.cantidad <= 0) {
      return err({ code: 'orden.consumo_cantidad_invalid',
        message: 'Consumption quantity must be positive' });
    }

    // Validar que el producto está en el BOM
    const componente = this.props.componentes.find((c) => c.productId === args.productId);
    if (!componente) {
      return err({ code: 'orden.product_not_in_bom',
        message: `Product ${args.productCode} is not in this order's BOM` });
    }

    const consumo = ConsumoMp.create({
      productId: args.productId,
      productCode: args.productCode,
      loteId: args.loteId,
      codigoLote: args.codigoLote,
      cantidad: args.cantidad,
      unidadMedida: args.unidadMedida,
      movimientoId: args.movimientoId,
      consumidoEn: args.now,
    });

    this.props = {
      ...this.props,
      consumos: [...this.props.consumos, consumo],
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new MaterialsConsumed({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      consumoId: consumo.id.value,
      productId: args.productId,
      productCode: args.productCode,
      loteId: args.loteId,
      cantidad: args.cantidad,
    }));

    return ok(consumo);
  }

  /** Registra un lote de PT producido (ya creado en inventario). */
  recordProduction(args: {
    loteId: string;
    codigoLote: string;
    productId: string;
    cantidad: number;
    locationId: string;
    movimientoId: string;
    now: Date;
  }): Result<LoteProducido, DomainError> {
    if (this.props.estado !== EstadoOrdenProduccion.EnProceso) {
      return err({ code: 'orden.must_be_en_proceso',
        message: `Cannot record production in state ${this.props.estado}` });
    }
    if (args.cantidad <= 0) {
      return err({ code: 'orden.produccion_cantidad_invalid',
        message: 'Production quantity must be positive' });
    }
    if (args.productId !== this.props.productoTerminadoId) {
      return err({ code: 'orden.wrong_product',
        message: `Expected product ${this.props.productoTerminadoId}, got ${args.productId}` });
    }

    const loteProducido = LoteProducido.create({
      loteId: args.loteId,
      codigoLote: args.codigoLote,
      productId: args.productId,
      cantidad: args.cantidad,
      locationId: args.locationId,
      movimientoId: args.movimientoId,
      producidoEn: args.now,
    });

    this.props = {
      ...this.props,
      lotesProducidos: [...this.props.lotesProducidos, loteProducido],
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new LotProduced({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      loteProducidoId: loteProducido.id.value,
      loteId: args.loteId,
      codigoLote: args.codigoLote,
      productId: args.productId,
      cantidad: args.cantidad,
    }));

    return ok(loteProducido);
  }

  /** Completa la orden. Requiere al menos un LoteProducido. */
  complete(args: { now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenProduccion.Completada)) {
      return err({ code: 'orden.invalid_transition',
        message: `Cannot complete from state ${this.props.estado}` });
    }
    if (this.props.lotesProducidos.length === 0) {
      return err({ code: 'orden.no_lots_produced',
        message: 'Cannot complete order without at least one produced lot' });
    }

    this.props = {
      ...this.props,
      estado: EstadoOrdenProduccion.Completada,
      completadoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new ProductionCompleted({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      codigo: this.props.codigo.value,
      productoTerminadoId: this.props.productoTerminadoId,
      cantidadObjetivo: this.props.cantidadObjetivo.amount,
      cantidadRealProducida: this.cantidadRealProducida,
      consumosCount: this.props.consumos.length,
      lotesProducidosCount: this.props.lotesProducidos.length,
    }));
    return ok(undefined);
  }

  /** Cancela la orden. Motivo obligatorio. */
  cancel(args: { motivo: string; canceladoPor: string; now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenProduccion.Cancelada)) {
      return err({ code: 'orden.cannot_cancel',
        message: `Cannot cancel from state ${this.props.estado}` });
    }
    if (!args.motivo || args.motivo.trim().length < 3) {
      return err({ code: 'orden.motivo_required',
        message: 'Cancellation requires a reason of at least 3 characters' });
    }

    this.props = {
      ...this.props,
      estado: EstadoOrdenProduccion.Cancelada,
      canceladoMotivo: args.motivo.trim(),
      canceladoPor: args.canceladoPor,
      canceladoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new ProductionCancelled({
      ordenId: this._id.value,
      tenantId: this.props.tenantId,
      codigo: this.props.codigo.value,
      motivo: args.motivo.trim(),
      canceladoPor: args.canceladoPor,
    }));
    return ok(undefined);
  }

  /** Cierra la orden (archivado final, solo desde Completada). */
  close(args: { now: Date }): Result<void, DomainError> {
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoOrdenProduccion.Cerrada)) {
      return err({ code: 'orden.invalid_transition',
        message: `Cannot close from state ${this.props.estado}` });
    }
    this.props = {
      ...this.props,
      estado: EstadoOrdenProduccion.Cerrada,
      cerradoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();
    return ok(undefined);
  }

  // ---------- Reconstitution ----------

  static reconstitute(args: {
    id: OrdenProduccionId;
    tenantId: string;
    codigo: CodigoOrdenProduccion;
    productoTerminadoId: string;
    productoTerminadoCode: string;
    productoTerminadoName: string;
    cantidadObjetivo: CantidadObjetivo;
    estado: EstadoOrdenProduccion;
    prioridad: PrioridadProduccion;
    componentes: ComponenteBomSnapshot[];
    materialesReservados: boolean;
    consumos: ConsumoMp[];
    lotesProducidos: LoteProducido[];
    notas: string | null;
    jornada?: string | null;
    canceladoMotivo: string | null;
    canceladoPor: string | null;
    canceladoEn: Date | null;
    fechaProgramada: Date | null;
    iniciadoEn: Date | null;
    completadoEn: Date | null;
    cerradoEn: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): OrdenDeProduccion {
    return new OrdenDeProduccion(args.id, {
      tenantId: args.tenantId,
      codigo: args.codigo,
      productoTerminadoId: args.productoTerminadoId,
      productoTerminadoCode: args.productoTerminadoCode,
      productoTerminadoName: args.productoTerminadoName,
      cantidadObjetivo: args.cantidadObjetivo,
      estado: args.estado,
      prioridad: args.prioridad,
      componentes: args.componentes,
      materialesReservados: args.materialesReservados,
      consumos: args.consumos,
      lotesProducidos: args.lotesProducidos,
      notas: args.notas,
      jornada: args.jornada ?? null,
      canceladoMotivo: args.canceladoMotivo,
      canceladoPor: args.canceladoPor,
      canceladoEn: args.canceladoEn,
      fechaProgramada: args.fechaProgramada,
      iniciadoEn: args.iniciadoEn,
      completadoEn: args.completadoEn,
      cerradoEn: args.cerradoEn,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}