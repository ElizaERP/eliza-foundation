import {
  AggregateRoot,
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';

import {
  Cantidad,
  LocationId,
  LoteId,
  MovimientoId,
  ReferenciaOrigen,
} from './value-objects';

/**
 * TipoMovimiento — clasificación del movimiento en el kardex.
 */
export enum TipoMovimiento {
  Entrada = 'Entrada',          // Recepción de compra, producción, ajuste positivo
  Salida = 'Salida',            // Despacho, ajuste negativo
  TransferenciaSalida = 'TransferenciaSalida',  // Sale de origen
  TransferenciaEntrada = 'TransferenciaEntrada', // Entra a destino
  Ajuste = 'Ajuste',            // Conteo físico
  Reserva = 'Reserva',           // Bloqueo de stock (no afecta total físico)
  LiberacionReserva = 'LiberacionReserva',
}

interface MovimientoProps {
  tenantId: string;
  tipo: TipoMovimiento;
  productId: string;
  loteId: LoteId | null;
  locationId: LocationId;
  locationDestinoId: LocationId | null;   // solo en transferencias
  cantidad: Cantidad;
  referencia: ReferenciaOrigen;
  motivo: string | null;
  ocurridoEn: Date;
  registradoPor: string;
  createdAt: Date;
}

/**
 * MovimientoInventario — Aggregate Root append-only.
 *
 * Representa un registro inmutable del kardex. Una vez creado NO se
 * modifica nunca; los ajustes posteriores generan nuevos movimientos.
 *
 * Esta inmutabilidad es lo que permite reconstruir el estado del
 * inventario en cualquier momento del tiempo (auditoría completa).
 *
 * Invariantes:
 *   1. cantidad > 0 (los signos los lleva el TipoMovimiento).
 *   2. Transferencias requieren locationDestinoId.
 *   3. Una vez creado, no muta nunca (no hay métodos mutadores).
 *
 * NOTA: Este agregado no emite eventos propios — los eventos de
 * dominio los emiten Lote y Existencia. MovimientoInventario es
 * la huella forense, no la fuente de hechos de negocio.
 */
export class MovimientoInventario extends AggregateRoot<MovimientoId, MovimientoProps> {
  private constructor(id: MovimientoId, props: MovimientoProps, version: number) {
    super(id, props, version);
  }

  // ---------- Getters ----------
  get tenantId(): string { return this.props.tenantId; }
  get tipo(): TipoMovimiento { return this.props.tipo; }
  get productId(): string { return this.props.productId; }
  get loteId(): LoteId | null { return this.props.loteId; }
  get locationId(): LocationId { return this.props.locationId; }
  get locationDestinoId(): LocationId | null { return this.props.locationDestinoId; }
  get cantidad(): Cantidad { return this.props.cantidad; }
  get referencia(): ReferenciaOrigen { return this.props.referencia; }
  get motivo(): string | null { return this.props.motivo; }
  get ocurridoEn(): Date { return this.props.ocurridoEn; }
  get registradoPor(): string { return this.props.registradoPor; }
  get createdAt(): Date { return this.props.createdAt; }

  // ---------- Factory ----------
  static create(args: {
    tenantId: string;
    tipo: TipoMovimiento;
    productId: string;
    loteId: string | null;
    locationId: string;
    locationDestinoId?: string;
    cantidad: number;
    referencia: ReferenciaOrigen;
    motivo?: string;
    ocurridoEn: Date;
    registradoPor: string;
    now: Date;
  }): Result<MovimientoInventario, DomainError> {
    const cantR = Cantidad.createPositive(args.cantidad);
    if (cantR.isErr) return err(cantR.error);

    // Transferencias requieren destino
    const esTransferencia =
      args.tipo === TipoMovimiento.TransferenciaSalida ||
      args.tipo === TipoMovimiento.TransferenciaEntrada;
    if (esTransferencia && !args.locationDestinoId) {
      return err({ code: 'movimiento.destino_required',
        message: 'Transferencias require locationDestinoId' });
    }

    // Ajustes requieren motivo
    if (args.tipo === TipoMovimiento.Ajuste && (!args.motivo || args.motivo.trim().length < 3)) {
      return err({ code: 'movimiento.motivo_required',
        message: 'Ajuste movements require motivo of at least 3 characters' });
    }

    const id = MovimientoId.generate();
    return ok(new MovimientoInventario(id, {
      tenantId: args.tenantId,
      tipo: args.tipo,
      productId: args.productId,
      loteId: args.loteId ? LoteId.fromString(args.loteId) : null,
      locationId: LocationId.fromString(args.locationId),
      locationDestinoId: args.locationDestinoId ? LocationId.fromString(args.locationDestinoId) : null,
      cantidad: cantR.value,
      referencia: args.referencia,
      motivo: args.motivo?.trim() || null,
      ocurridoEn: args.ocurridoEn,
      registradoPor: args.registradoPor,
      createdAt: args.now,
    }, 1));
  }

  static reconstitute(args: {
    id: MovimientoId;
    tenantId: string;
    tipo: TipoMovimiento;
    productId: string;
    loteId: LoteId | null;
    locationId: LocationId;
    locationDestinoId: LocationId | null;
    cantidad: Cantidad;
    referencia: ReferenciaOrigen;
    motivo: string | null;
    ocurridoEn: Date;
    registradoPor: string;
    createdAt: Date;
  }): MovimientoInventario {
    return new MovimientoInventario(args.id, {
      tenantId: args.tenantId,
      tipo: args.tipo,
      productId: args.productId,
      loteId: args.loteId,
      locationId: args.locationId,
      locationDestinoId: args.locationDestinoId,
      cantidad: args.cantidad,
      referencia: args.referencia,
      motivo: args.motivo,
      ocurridoEn: args.ocurridoEn,
      registradoPor: args.registradoPor,
      createdAt: args.createdAt,
    }, 1);
  }
}
