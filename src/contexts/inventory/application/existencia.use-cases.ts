import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';
import {
  Cantidad,
  EXISTENCIA_REPOSITORY,
  EstadoLote,
  Existencia,
  ExistenciaId,
  ExistenciaRepository,
  LOCATION_REPOSITORY,
  LOTE_REPOSITORY,
  LocationId,
  LocationRepository,
  LoteId,
  LoteRepository,
  MOVIMIENTO_REPOSITORY,
  MovimientoInventario,
  MovimientoRepository,
  ReferenciaOrigen,
  TipoMovimiento,
  TipoReferencia,
} from '@eliza/contexts/inventory/domain';
import { FefoReservationService } from '@eliza/contexts/inventory/infrastructure/services/fefo-reservation.service';
import {
  ExistenciaView,
  StockSummaryView,
  toExistenciaView,
} from '@eliza/contexts/inventory/application/dto/inventory.views';

// =====================================================================
// ReceiveInventory
// =====================================================================
export interface ReceiveInventoryInput {
  productId: string; loteId: string; locationId: string; cantidad: number;
  referenciaTipo: TipoReferencia; referenciaId: string;
}
export interface ReceiveInventoryOutput { existencia: ExistenciaView; movimientoId: string; }

@Injectable()
export class ReceiveInventoryUseCase implements UseCase<ReceiveInventoryInput, ReceiveInventoryOutput> {
  private readonly logger = new Logger(ReceiveInventoryUseCase.name);
  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    @Inject(MOVIMIENTO_REPOSITORY) private readonly movimientoRepo: MovimientoRepository,
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
    @Inject(LOCATION_REPOSITORY) private readonly locationRepo: LocationRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ReceiveInventoryInput): Promise<Result<ReceiveInventoryOutput, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const lote = await this.loteRepo.findById(LoteId.fromString(input.loteId));
    if (!lote) return err(applicationError('inventory.lote_not_found', `Lote ${input.loteId} not found`, 'not_found'));
    if (lote.productId !== input.productId) return err(applicationError('inventory.lote_product_mismatch', `Lote belongs to product ${lote.productId}, not ${input.productId}`, 'validation'));
    if (lote.estado === EstadoLote.Vencido) return err(applicationError('inventory.lote_expired', `Cannot receive into an expired lot`, 'validation'));

    const location = await this.locationRepo.findById(LocationId.fromString(input.locationId));
    if (!location) return err(applicationError('inventory.location_not_found', `Location ${input.locationId} not found`, 'not_found'));
    if (!location.isActive) return err(applicationError('inventory.location_inactive', `Location ${input.locationId} is not active`, 'validation'));

    const cantR = Cantidad.createPositive(input.cantidad);
    if (cantR.isErr) return err(applicationError(cantR.error.code, cantR.error.message, 'validation'));
    const refR = ReferenciaOrigen.create(input.referenciaTipo, input.referenciaId);
    if (refR.isErr) return err(applicationError(refR.error.code, refR.error.message, 'validation'));

    let existencia = await this.existenciaRepo.findByCompositeKey(input.productId, input.loteId, input.locationId);
    if (!existencia) {
      existencia = Existencia.createEmpty({ tenantId, productId: input.productId, loteId: input.loteId, locationId: input.locationId, now });
    }

    const movR = MovimientoInventario.create({ tenantId, tipo: TipoMovimiento.Entrada, productId: input.productId,
      loteId: input.loteId, locationId: input.locationId, cantidad: input.cantidad,
      referencia: refR.value, ocurridoEn: now, registradoPor: userId, now });
    if (movR.isErr) return err(applicationError(movR.error.code, movR.error.message, 'validation'));

    const recR = existencia.receive({ cantidad: cantR.value, movimientoId: movR.value.id.value, referencia: refR.value, now });
    if (recR.isErr) return err(applicationError(recR.error.code, recR.error.message, 'validation'));

    await this.movimientoRepo.append(movR.value);
    await this.existenciaRepo.save(existencia);
    this.logger.log(`Received ${input.cantidad} of ${input.productId} in lote ${input.loteId}`);
    return ok({ existencia: toExistenciaView(existencia), movimientoId: movR.value.id.value });
  }
}

// =====================================================================
// ReserveStock — FEFO multi-lote
// =====================================================================
export interface ReserveStockInput {
  productId: string; cantidad: number; referenciaTipo: TipoReferencia; referenciaId: string; locationId?: string;
}
export interface ReserveStockOutput {
  totalAsignado: number;
  asignaciones: Array<{ existenciaId: string; loteId: string; codigoLote: string; fechaVencimiento: string; cantidadAsignada: number; }>;
  reservaIds: string[];
}

@Injectable()
export class ReserveStockUseCase implements UseCase<ReserveStockInput, ReserveStockOutput> {
  private readonly logger = new Logger(ReserveStockUseCase.name);
  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    private readonly fefo: FefoReservationService,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ReserveStockInput): Promise<Result<ReserveStockOutput, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const now = this.clock.now();

    const cantR = Cantidad.createPositive(input.cantidad);
    if (cantR.isErr) return err(applicationError(cantR.error.code, cantR.error.message, 'validation'));
    const refR = ReferenciaOrigen.create(input.referenciaTipo, input.referenciaId);
    if (refR.isErr) return err(applicationError(refR.error.code, refR.error.message, 'validation'));

    const fefoR = await this.fefo.assign({ productId: input.productId, cantidadTotal: cantR.value, referencia: refR.value, locationId: input.locationId, now });
    if (fefoR.isErr) {
      const category = fefoR.error.code.includes('insufficient') || fefoR.error.code.includes('no_stock') ? 'conflict' : 'validation';
      return err(applicationError(fefoR.error.code, fefoR.error.message, category));
    }

    for (const existencia of fefoR.value.existenciasModificadas) {
      await this.existenciaRepo.save(existencia);
    }
    this.logger.log(`Reserved ${input.cantidad} of ${input.productId} for ${refR.value.key}`);
    return ok({
      totalAsignado: fefoR.value.resultado.totalAsignado,
      asignaciones: fefoR.value.resultado.asignaciones.map((a) => ({
        existenciaId: a.existenciaId, loteId: a.loteId, codigoLote: a.codigoLote,
        fechaVencimiento: a.fechaVencimiento.toISOString(), cantidadAsignada: a.cantidadAsignada,
      })),
      reservaIds: fefoR.value.resultado.reservaIds,
    });
  }
}

// =====================================================================
// ReleaseReservation
// =====================================================================
export interface ReleaseReservationInput { productId: string; referenciaTipo: TipoReferencia; referenciaId: string; reason: string; }

@Injectable()
export class ReleaseReservationUseCase implements UseCase<ReleaseReservationInput, { released: number }> {
  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ReleaseReservationInput): Promise<Result<{ released: number }, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const now = this.clock.now();
    const refR = ReferenciaOrigen.create(input.referenciaTipo, input.referenciaId);
    if (refR.isErr) return err(applicationError(refR.error.code, refR.error.message, 'validation'));

    const existencias = await this.existenciaRepo.findBySku(input.productId);
    let released = 0;
    for (const e of existencias) {
      const reserva = e.findActiveReservation(refR.value);
      if (!reserva) continue;
      const r = e.releaseReservation({ referencia: refR.value, reason: input.reason, now });
      if (r.isOk) { await this.existenciaRepo.save(e); released++; }
    }
    if (released === 0) return err(applicationError('inventory.no_reservations_found', `No active reservations found for ${refR.value.key}`, 'not_found'));
    return ok({ released });
  }
}

// =====================================================================
// AdjustStock
// =====================================================================
export interface AdjustStockInput { existenciaId: string; delta: number; motivo: string; }

@Injectable()
export class AdjustStockUseCase implements UseCase<AdjustStockInput, ExistenciaView> {
  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    @Inject(MOVIMIENTO_REPOSITORY) private readonly movimientoRepo: MovimientoRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: AdjustStockInput): Promise<Result<ExistenciaView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const existencia = await this.existenciaRepo.findById(ExistenciaId.fromString(input.existenciaId));
    if (!existencia) return err(applicationError('inventory.existencia_not_found', `Existencia ${input.existenciaId} not found`, 'not_found'));

    const refR = ReferenciaOrigen.create(TipoReferencia.Adjustment, input.existenciaId);
    if (refR.isErr) return err(applicationError(refR.error.code, refR.error.message, 'validation'));

    const movR = MovimientoInventario.create({ tenantId, tipo: TipoMovimiento.Ajuste, productId: existencia.productId,
      loteId: existencia.loteId.value, locationId: existencia.locationId.value,
      cantidad: Math.abs(input.delta), referencia: refR.value, motivo: input.motivo,
      ocurridoEn: now, registradoPor: userId, now });
    if (movR.isErr) return err(applicationError(movR.error.code, movR.error.message, 'validation'));

    const adjR = existencia.adjust({ delta: input.delta, motivo: input.motivo, movimientoId: movR.value.id.value, now });
    if (adjR.isErr) return err(applicationError(adjR.error.code, adjR.error.message, 'validation'));

    await this.movimientoRepo.append(movR.value);
    await this.existenciaRepo.save(existencia);
    return ok(toExistenciaView(existencia));
  }
}

// =====================================================================
// TransferStock
// =====================================================================
export interface TransferStockInput { productId: string; loteId: string; origenLocationId: string; destinoLocationId: string; cantidad: number; }

@Injectable()
export class TransferStockUseCase implements UseCase<TransferStockInput, { ok: true; movimientos: string[] }> {
  private readonly logger = new Logger(TransferStockUseCase.name);
  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    @Inject(MOVIMIENTO_REPOSITORY) private readonly movimientoRepo: MovimientoRepository,
    @Inject(LOCATION_REPOSITORY) private readonly locationRepo: LocationRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: TransferStockInput): Promise<Result<{ ok: true; movimientos: string[] }, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    if (input.origenLocationId === input.destinoLocationId) return err(applicationError('inventory.same_origin_destino', 'Origin and destination must be different', 'validation'));

    const destino = await this.locationRepo.findById(LocationId.fromString(input.destinoLocationId));
    if (!destino || !destino.isActive) return err(applicationError('inventory.location_not_found', `Destination location not found or inactive`, 'not_found'));

    const origenExistencia = await this.existenciaRepo.findByCompositeKey(input.productId, input.loteId, input.origenLocationId);
    if (!origenExistencia) return err(applicationError('inventory.existencia_not_found', `No existencia at origin`, 'not_found'));
    if (origenExistencia.cantidadDisponible.amount < input.cantidad) return err(applicationError('inventory.insufficient_stock', `Cannot transfer ${input.cantidad}; only ${origenExistencia.cantidadDisponible.amount} available`, 'conflict'));

    const refTransfer = ReferenciaOrigen.create(TipoReferencia.Transfer, `${input.origenLocationId}->${input.destinoLocationId}`);
    if (refTransfer.isErr) return err(applicationError(refTransfer.error.code, refTransfer.error.message, 'validation'));

    const movSalidaR = MovimientoInventario.create({ tenantId, tipo: TipoMovimiento.TransferenciaSalida, productId: input.productId, loteId: input.loteId, locationId: input.origenLocationId, locationDestinoId: input.destinoLocationId, cantidad: input.cantidad, referencia: refTransfer.value, ocurridoEn: now, registradoPor: userId, now });
    if (movSalidaR.isErr) return err(applicationError(movSalidaR.error.code, movSalidaR.error.message, 'validation'));

    const movEntradaR = MovimientoInventario.create({ tenantId, tipo: TipoMovimiento.TransferenciaEntrada, productId: input.productId, loteId: input.loteId, locationId: input.destinoLocationId, locationDestinoId: input.origenLocationId, cantidad: input.cantidad, referencia: refTransfer.value, ocurridoEn: now, registradoPor: userId, now });
    if (movEntradaR.isErr) return err(applicationError(movEntradaR.error.code, movEntradaR.error.message, 'validation'));

    const adjOrigenR = origenExistencia.adjust({ delta: -input.cantidad, motivo: `Transfer to location ${input.destinoLocationId}`, movimientoId: movSalidaR.value.id.value, now });
    if (adjOrigenR.isErr) return err(applicationError(adjOrigenR.error.code, adjOrigenR.error.message, 'validation'));

    let destinoExistencia = await this.existenciaRepo.findByCompositeKey(input.productId, input.loteId, input.destinoLocationId);
    if (!destinoExistencia) destinoExistencia = Existencia.createEmpty({ tenantId, productId: input.productId, loteId: input.loteId, locationId: input.destinoLocationId, now });

    const cantR = Cantidad.createPositive(input.cantidad);
    if (cantR.isErr) return err(applicationError(cantR.error.code, cantR.error.message, 'validation'));
    const recR = destinoExistencia.receive({ cantidad: cantR.value, movimientoId: movEntradaR.value.id.value, referencia: refTransfer.value, now });
    if (recR.isErr) return err(applicationError(recR.error.code, recR.error.message, 'validation'));

    await this.movimientoRepo.append(movSalidaR.value);
    await this.movimientoRepo.append(movEntradaR.value);
    await this.existenciaRepo.save(origenExistencia);
    await this.existenciaRepo.save(destinoExistencia);
    return ok({ ok: true as const, movimientos: [movSalidaR.value.id.value, movEntradaR.value.id.value] });
  }
}

// =====================================================================
// DispatchInventory
// =====================================================================
export interface DispatchInventoryInput { productId: string; referenciaTipo: TipoReferencia; referenciaId: string; }

@Injectable()
export class DispatchInventoryUseCase implements UseCase<DispatchInventoryInput, { totalDespachado: number; movimientoIds: string[] }> {
  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    @Inject(MOVIMIENTO_REPOSITORY) private readonly movimientoRepo: MovimientoRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: DispatchInventoryInput): Promise<Result<{ totalDespachado: number; movimientoIds: string[] }, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const refR = ReferenciaOrigen.create(input.referenciaTipo, input.referenciaId);
    if (refR.isErr) return err(applicationError(refR.error.code, refR.error.message, 'validation'));

    const existencias = await this.existenciaRepo.findBySku(input.productId);
    let totalDespachado = 0;
    const movimientoIds: string[] = [];
    for (const e of existencias) {
      const reserva = e.findActiveReservation(refR.value);
      if (!reserva) continue;
      const movR = MovimientoInventario.create({ tenantId, tipo: TipoMovimiento.Salida, productId: input.productId, loteId: e.loteId.value, locationId: e.locationId.value, cantidad: reserva.cantidad.amount, referencia: refR.value, ocurridoEn: now, registradoPor: userId, now });
      if (movR.isErr) return err(applicationError(movR.error.code, movR.error.message, 'validation'));
      const dispR = e.dispatch({ referencia: refR.value, movimientoId: movR.value.id.value, now });
      if (dispR.isErr) return err(applicationError(dispR.error.code, dispR.error.message, 'validation'));
      await this.movimientoRepo.append(movR.value);
      await this.existenciaRepo.save(e);
      totalDespachado += dispR.value;
      movimientoIds.push(movR.value.id.value);
    }
    if (totalDespachado === 0) return err(applicationError('inventory.no_reservations_to_dispatch', `No active reservations found for ${refR.value.key}`, 'not_found'));
    return ok({ totalDespachado, movimientoIds });
  }
}

// =====================================================================
// GetStockBySku
// =====================================================================
@Injectable()
export class GetStockBySkuUseCase implements UseCase<{ productId: string }, StockSummaryView> {
  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
  ) {}

  async execute(input: { productId: string }): Promise<Result<StockSummaryView, ApplicationError>> {
    const existencias = await this.existenciaRepo.findBySku(input.productId);
    const byLote = new Map<string, { loteId: string; codigoLote: string; fechaVencimiento: string; estado: EstadoLote;
          cantidadDisponible: number; cantidadReservada: number; cantidadBloqueada: number;
          ubicaciones: Map<string, { disponible: number; reservada: number }>; }>();
    let totalDisponible = 0, totalReservado = 0, totalBloqueado = 0;

    for (const e of existencias) {
      totalDisponible += e.cantidadDisponible.amount;
      totalReservado += e.cantidadReservada.amount;
      totalBloqueado += e.cantidadBloqueada.amount;
      const loteIdStr = e.loteId.value;
      let entry = byLote.get(loteIdStr);
      if (!entry) {
        const lote = await this.loteRepo.findById(e.loteId);
        if (!lote) continue;
        entry = { loteId: loteIdStr, codigoLote: lote.codigoLote, fechaVencimiento: lote.fechaVencimiento.iso,
          estado: lote.estado, cantidadDisponible: 0, cantidadReservada: 0, cantidadBloqueada: 0, ubicaciones: new Map() };
        byLote.set(loteIdStr, entry);
      }
      entry.cantidadDisponible += e.cantidadDisponible.amount;
      entry.cantidadReservada += e.cantidadReservada.amount;
      entry.cantidadBloqueada += e.cantidadBloqueada.amount;
      entry.ubicaciones.set(e.locationId.value, { disponible: e.cantidadDisponible.amount, reservada: e.cantidadReservada.amount });
    }

    return ok({
      productId: input.productId, totalDisponible, totalReservado, totalBloqueado,
      totalFisico: totalDisponible + totalReservado + totalBloqueado,
      porLote: Array.from(byLote.values())
        .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento))
        .map((l) => ({
          ...l, ubicaciones: Array.from(l.ubicaciones.entries()).map(([locId, qts]) => ({
            locationId: locId, cantidadDisponible: qts.disponible, cantidadReservada: qts.reservada,
          })),
        })),
    });
  }
}
