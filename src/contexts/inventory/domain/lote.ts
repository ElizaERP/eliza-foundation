import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  LotBlocked,
  LotExpired,
  LotNearExpiry,
  LotRegistered,
  LotReleased,
} from './inventory-events';
import {
  Cantidad,
  CodigoLote,
  FechaVencimiento,
  LoteId,
} from './value-objects';

/**
 * EstadoLote — máquina de estados del lote físico.
 *
 *   Disponible    → estado normal, puede reservarse
 *   Bloqueado     → no se puede reservar (decisión de Quality o Logistics)
 *   Cuarentena    → pendiente de inspección (Quality lo libera o bloquea)
 *   Vencido       → fechaVencimiento <= now (terminal-ish; se requiere baja por ajuste)
 *   Agotado       → cantidadDisponible total = 0 (computed, no almacenado)
 */
export enum EstadoLote {
  Disponible = 'Disponible',
  Bloqueado = 'Bloqueado',
  Cuarentena = 'Cuarentena',
  Vencido = 'Vencido',
}

/**
 * OrigenLote — qué causó la creación del lote.
 * Production:  ProductionOrder → Manufacturing.LotProduced (futuro Sprint)
 * Purchase:    PurchaseOrder   → Procurement.GoodsReceived (futuro Sprint)
 * Manual:      Recibir inventario inicial sin orden previa
 */
export enum OrigenLote {
  Production = 'Production',
  Purchase = 'Purchase',
  Manual = 'Manual',
}

const VALID_TRANSITIONS: Record<EstadoLote, EstadoLote[]> = {
  [EstadoLote.Disponible]: [EstadoLote.Bloqueado, EstadoLote.Cuarentena, EstadoLote.Vencido],
  [EstadoLote.Cuarentena]: [EstadoLote.Disponible, EstadoLote.Bloqueado, EstadoLote.Vencido],
  [EstadoLote.Bloqueado]: [EstadoLote.Disponible, EstadoLote.Vencido],
  [EstadoLote.Vencido]: [], // terminal
};

interface LoteProps {
  tenantId: string;
  codigoLote: CodigoLote;
  productId: string;
  fechaProduccion: Date;
  fechaVencimiento: FechaVencimiento;
  cantidadInicial: Cantidad;
  estado: EstadoLote;
  origenTipo: OrigenLote;
  origenRef: string | null; // ID de la OrdenDeProduccion o OrdenDeCompra
  bloqueadoMotivo: string | null;
  bloqueadoPor: string | null;
  bloqueadoEn: Date | null;
  notas: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lote — Aggregate Root.
 *
 * Representa una unidad física de trazabilidad: un grupo de producto
 * fabricado o recibido bajo las mismas condiciones, con una fecha de
 * producción y vencimiento únicas.
 *
 * Invariantes:
 *   1. fechaVencimiento es inmutable una vez creada.
 *   2. cantidadInicial NUNCA cambia (es histórica).
 *   3. La cantidad actual disponible la mantiene Existencia, no Lote.
 *   4. Un lote Vencido es terminal (requiere ajuste para sacarlo).
 *   5. Un lote en Bloqueado solo puede pasar a Disponible vía liberación
 *      explícita (en el futuro: por Quality.LotReleased).
 *   6. codigoLote único por tenant + product.
 */
export class Lote extends AggregateRoot<LoteId, LoteProps> {
  private constructor(id: LoteId, props: LoteProps, version: number) {
    super(id, props, version);
  }

  // ---------- Getters ----------
  get tenantId(): string { return this.props.tenantId; }
  get codigoLote(): string { return this.props.codigoLote.value; }
  get productId(): string { return this.props.productId; }
  get fechaProduccion(): Date { return this.props.fechaProduccion; }
  get fechaVencimiento(): FechaVencimiento { return this.props.fechaVencimiento; }
  get cantidadInicial(): number { return this.props.cantidadInicial.amount; }
  get estado(): EstadoLote { return this.props.estado; }
  get origenTipo(): OrigenLote { return this.props.origenTipo; }
  get origenRef(): string | null { return this.props.origenRef; }
  get bloqueadoMotivo(): string | null { return this.props.bloqueadoMotivo; }
  get bloqueadoPor(): string | null { return this.props.bloqueadoPor; }
  get bloqueadoEn(): Date | null { return this.props.bloqueadoEn; }
  get notas(): string | null { return this.props.notas; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** ¿Está disponible para reserva? */
  esReservable(now: Date): boolean {
    if (this.props.estado !== EstadoLote.Disponible) return false;
    if (this.props.fechaVencimiento.isExpired(now)) return false;
    return true;
  }

  // ---------- Factory ----------
  static create(args: {
    tenantId: string;
    codigoLote: string;
    productId: string;
    fechaProduccion: Date;
    fechaVencimiento: Date;
    cantidadInicial: number;
    origenTipo: OrigenLote;
    origenRef?: string;
    notas?: string;
    now: Date;
  }): Result<Lote, DomainError> {
    const codigoR = CodigoLote.create(args.codigoLote);
    if (codigoR.isErr) return err(codigoR.error);

    if (!(args.fechaProduccion instanceof Date) || isNaN(args.fechaProduccion.getTime())) {
      return err({ code: 'lote.fecha_produccion_invalid', message: 'Invalid fechaProduccion' });
    }

    // fechaProduccion no puede ser futura
    if (args.fechaProduccion.getTime() > args.now.getTime()) {
      return err({ code: 'lote.fecha_produccion_future',
        message: 'fechaProduccion cannot be in the future' });
    }

    const fechaVencR = FechaVencimiento.create(args.fechaVencimiento, args.now);
    if (fechaVencR.isErr) return err(fechaVencR.error);

    // fechaVencimiento debe ser posterior a fechaProduccion
    if (args.fechaVencimiento.getTime() <= args.fechaProduccion.getTime()) {
      return err({ code: 'lote.fecha_vencimiento_before_produccion',
        message: 'fechaVencimiento must be after fechaProduccion' });
    }

    const cantR = Cantidad.createPositive(args.cantidadInicial);
    if (cantR.isErr) return err(cantR.error);

    // Validar origenRef cuando aplique
    if (args.origenTipo === OrigenLote.Production && !args.origenRef) {
      return err({ code: 'lote.origen_ref_required',
        message: 'Production origin requires origenRef (ProductionOrder id)' });
    }
    if (args.origenTipo === OrigenLote.Purchase && !args.origenRef) {
      return err({ code: 'lote.origen_ref_required',
        message: 'Purchase origin requires origenRef (PurchaseOrder id)' });
    }

    const id = LoteId.generate();
    const lote = new Lote(id, {
      tenantId: args.tenantId,
      codigoLote: codigoR.value,
      productId: args.productId,
      fechaProduccion: args.fechaProduccion,
      fechaVencimiento: fechaVencR.value,
      cantidadInicial: cantR.value,
      estado: EstadoLote.Disponible,
      origenTipo: args.origenTipo,
      origenRef: args.origenRef ?? null,
      bloqueadoMotivo: null,
      bloqueadoPor: null,
      bloqueadoEn: null,
      notas: args.notas?.trim() || null,
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    lote.addDomainEvent(new LotRegistered({
      loteId: id.value,
      tenantId: args.tenantId,
      codigoLote: codigoR.value.value,
      productId: args.productId,
      fechaProduccion: args.fechaProduccion.toISOString(),
      fechaVencimiento: args.fechaVencimiento.toISOString(),
      cantidadInicial: cantR.value.amount,
      origenTipo: args.origenTipo,
      origenRef: args.origenRef ?? null,
    }));

    return ok(lote);
  }

  // ---------- State transitions ----------

  /** Bloquea el lote. Lo invoca Quality, Logistics o operación manual. */
  block(args: { reason: string; blockedBy: string; now: Date }): Result<void, DomainError> {
    if (this.props.estado === EstadoLote.Bloqueado) {
      return err({ code: 'lote.already_blocked', message: 'Lot is already blocked' });
    }
    if (!VALID_TRANSITIONS[this.props.estado].includes(EstadoLote.Bloqueado)) {
      return err({ code: 'lote.invalid_transition',
        message: `Cannot transition from ${this.props.estado} to Bloqueado` });
    }
    if (!args.reason || args.reason.trim().length < 3) {
      return err({ code: 'lote.reason_required',
        message: 'A reason of at least 3 characters is required' });
    }

    this.props = {
      ...this.props,
      estado: EstadoLote.Bloqueado,
      bloqueadoMotivo: args.reason.trim(),
      bloqueadoPor: args.blockedBy,
      bloqueadoEn: args.now,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new LotBlocked({
      loteId: this._id.value,
      tenantId: this.props.tenantId,
      codigoLote: this.props.codigoLote.value,
      reason: args.reason.trim(),
      blockedBy: args.blockedBy,
    }));
    return ok(undefined);
  }

  /** Libera un lote bloqueado (vuelve a Disponible). */
  release(args: { releasedBy: string; now: Date }): Result<void, DomainError> {
    if (this.props.estado !== EstadoLote.Bloqueado && this.props.estado !== EstadoLote.Cuarentena) {
      return err({ code: 'lote.cannot_release',
        message: `Only blocked or quarantine lots can be released (current: ${this.props.estado})` });
    }
    this.props = {
      ...this.props,
      estado: EstadoLote.Disponible,
      bloqueadoMotivo: null,
      bloqueadoPor: null,
      bloqueadoEn: null,
      updatedAt: args.now,
    };
    this.incrementVersion();

    this.addDomainEvent(new LotReleased({
      loteId: this._id.value,
      tenantId: this.props.tenantId,
      codigoLote: this.props.codigoLote.value,
      releasedBy: args.releasedBy,
    }));
    return ok(undefined);
  }

  /** Marca el lote como vencido. Lo invoca un job programado. */
  markExpired(args: { now: Date; cantidadAfectada: number }): Result<void, DomainError> {
    if (this.props.estado === EstadoLote.Vencido) {
      return err({ code: 'lote.already_expired', message: 'Lot is already expired' });
    }
    if (!this.props.fechaVencimiento.isExpired(args.now)) {
      return err({ code: 'lote.not_yet_expired',
        message: 'Cannot mark as expired before fechaVencimiento' });
    }
    this.props = { ...this.props, estado: EstadoLote.Vencido, updatedAt: args.now };
    this.incrementVersion();

    this.addDomainEvent(new LotExpired({
      loteId: this._id.value,
      tenantId: this.props.tenantId,
      codigoLote: this.props.codigoLote.value,
      productId: this.props.productId,
      fechaVencimiento: this.props.fechaVencimiento.iso,
      cantidadAfectada: args.cantidadAfectada,
    }));
    return ok(undefined);
  }

  /** Emite un evento de alerta cuando el lote está próximo a vencer. */
  emitNearExpiryAlert(args: { now: Date; thresholdDays: number }): Result<void, DomainError> {
    const dias = this.props.fechaVencimiento.daysUntilExpiry(args.now);
    if (dias > args.thresholdDays || dias < 0) {
      return err({ code: 'lote.not_near_expiry',
        message: `Lot has ${dias} days until expiry (threshold: ${args.thresholdDays})` });
    }
    this.addDomainEvent(new LotNearExpiry({
      loteId: this._id.value,
      tenantId: this.props.tenantId,
      productId: this.props.productId,
      diasRestantes: dias,
      fechaVencimiento: this.props.fechaVencimiento.iso,
    }));
    return ok(undefined);
  }

  // ---------- Reconstitution ----------
  static reconstitute(args: {
    id: LoteId;
    tenantId: string;
    codigoLote: CodigoLote;
    productId: string;
    fechaProduccion: Date;
    fechaVencimiento: FechaVencimiento;
    cantidadInicial: Cantidad;
    estado: EstadoLote;
    origenTipo: OrigenLote;
    origenRef: string | null;
    bloqueadoMotivo: string | null;
    bloqueadoPor: string | null;
    bloqueadoEn: Date | null;
    notas: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Lote {
    return new Lote(args.id, {
      tenantId: args.tenantId,
      codigoLote: args.codigoLote,
      productId: args.productId,
      fechaProduccion: args.fechaProduccion,
      fechaVencimiento: args.fechaVencimiento,
      cantidadInicial: args.cantidadInicial,
      estado: args.estado,
      origenTipo: args.origenTipo,
      origenRef: args.origenRef,
      bloqueadoMotivo: args.bloqueadoMotivo,
      bloqueadoPor: args.bloqueadoPor,
      bloqueadoEn: args.bloqueadoEn,
      notas: args.notas,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}
