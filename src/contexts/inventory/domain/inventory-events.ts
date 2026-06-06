import { DomainEvent } from '@eliza/shared-kernel/domain';

// =====================================================================
// Lote events
// =====================================================================

interface LotRegisteredArgs {
  loteId: string;
  tenantId: string;
  codigoLote: string;
  productId: string;
  fechaProduccion: string;
  fechaVencimiento: string;
  cantidadInicial: number;
  origenTipo: string;
  origenRef: string | null;
  correlationId?: string;
  userId?: string;
}

export class LotRegistered extends DomainEvent {
  constructor(private readonly args: LotRegisteredArgs) {
    super({
      eventType: 'inventory.LotRegistered.v1',
      eventVersion: 1,
      aggregateType: 'Lote',
      aggregateId: args.loteId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      loteId: this.args.loteId,
      codigoLote: this.args.codigoLote,
      productId: this.args.productId,
      fechaProduccion: this.args.fechaProduccion,
      fechaVencimiento: this.args.fechaVencimiento,
      cantidadInicial: this.args.cantidadInicial,
      origenTipo: this.args.origenTipo,
      origenRef: this.args.origenRef,
    };
  }
}

interface LotBlockedArgs {
  loteId: string; tenantId: string; codigoLote: string;
  reason: string; blockedBy: string;
  correlationId?: string; userId?: string;
}

export class LotBlocked extends DomainEvent {
  constructor(private readonly args: LotBlockedArgs) {
    super({ eventType: 'inventory.LotBlocked.v1', eventVersion: 1, aggregateType: 'Lote',
      aggregateId: args.loteId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { loteId: this.args.loteId, codigoLote: this.args.codigoLote, reason: this.args.reason, blockedBy: this.args.blockedBy };
  }
}

interface LotReleasedArgs {
  loteId: string; tenantId: string; codigoLote: string; releasedBy: string;
  correlationId?: string; userId?: string;
}

export class LotReleased extends DomainEvent {
  constructor(private readonly args: LotReleasedArgs) {
    super({ eventType: 'inventory.LotReleased.v1', eventVersion: 1, aggregateType: 'Lote',
      aggregateId: args.loteId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { loteId: this.args.loteId, codigoLote: this.args.codigoLote, releasedBy: this.args.releasedBy };
  }
}

interface LotExpiredArgs {
  loteId: string; tenantId: string; codigoLote: string; productId: string;
  fechaVencimiento: string; cantidadAfectada: number;
}

export class LotExpired extends DomainEvent {
  constructor(private readonly args: LotExpiredArgs) {
    super({ eventType: 'inventory.LotExpired.v1', eventVersion: 1, aggregateType: 'Lote',
      aggregateId: args.loteId, tenantId: args.tenantId });
  }
  payload(): Record<string, unknown> {
    return { loteId: this.args.loteId, codigoLote: this.args.codigoLote, productId: this.args.productId,
      fechaVencimiento: this.args.fechaVencimiento, cantidadAfectada: this.args.cantidadAfectada };
  }
}

interface LotNearExpiryArgs {
  loteId: string; tenantId: string; productId: string; diasRestantes: number; fechaVencimiento: string;
}

export class LotNearExpiry extends DomainEvent {
  constructor(private readonly args: LotNearExpiryArgs) {
    super({ eventType: 'inventory.LotNearExpiry.v1', eventVersion: 1, aggregateType: 'Lote',
      aggregateId: args.loteId, tenantId: args.tenantId });
  }
  payload(): Record<string, unknown> {
    return { loteId: this.args.loteId, productId: this.args.productId,
      diasRestantes: this.args.diasRestantes, fechaVencimiento: this.args.fechaVencimiento };
  }
}

// =====================================================================
// Existencia / Inventario events
// =====================================================================

interface InventoryReceivedArgs {
  existenciaId: string; tenantId: string; productId: string; loteId: string;
  locationId: string; cantidad: number; movimientoId: string;
  referenciaTipo: string; referenciaId: string;
  correlationId?: string; userId?: string;
}

export class InventoryReceived extends DomainEvent {
  constructor(private readonly args: InventoryReceivedArgs) {
    super({ eventType: 'inventory.InventoryReceived.v1', eventVersion: 1, aggregateType: 'Existencia',
      aggregateId: args.existenciaId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { existenciaId: this.args.existenciaId, productId: this.args.productId,
      loteId: this.args.loteId, locationId: this.args.locationId, cantidad: this.args.cantidad,
      movimientoId: this.args.movimientoId, referenciaTipo: this.args.referenciaTipo, referenciaId: this.args.referenciaId };
  }
}

interface InventoryReservedArgs {
  existenciaId: string; reservaId: string; tenantId: string; productId: string;
  loteId: string; locationId: string; cantidad: number;
  referenciaTipo: string; referenciaId: string;
  correlationId?: string; userId?: string;
}

export class InventoryReserved extends DomainEvent {
  constructor(private readonly args: InventoryReservedArgs) {
    super({ eventType: 'inventory.InventoryReserved.v1', eventVersion: 1, aggregateType: 'Existencia',
      aggregateId: args.existenciaId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { existenciaId: this.args.existenciaId, reservaId: this.args.reservaId,
      productId: this.args.productId, loteId: this.args.loteId, locationId: this.args.locationId,
      cantidad: this.args.cantidad, referenciaTipo: this.args.referenciaTipo, referenciaId: this.args.referenciaId };
  }
}

interface ReservationReleasedArgs {
  existenciaId: string; reservaId: string; tenantId: string; productId: string;
  loteId: string; cantidad: number; motivo: string;
  correlationId?: string; userId?: string;
}

export class ReservationReleased extends DomainEvent {
  constructor(private readonly args: ReservationReleasedArgs) {
    super({ eventType: 'inventory.ReservationReleased.v1', eventVersion: 1, aggregateType: 'Existencia',
      aggregateId: args.existenciaId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { existenciaId: this.args.existenciaId, reservaId: this.args.reservaId,
      productId: this.args.productId, loteId: this.args.loteId, cantidad: this.args.cantidad, motivo: this.args.motivo };
  }
}

interface InventoryAdjustedArgs {
  existenciaId: string; tenantId: string; productId: string; loteId: string;
  locationId: string; delta: number; motivo: string; movimientoId: string;
  correlationId?: string; userId?: string;
}

export class InventoryAdjusted extends DomainEvent {
  constructor(private readonly args: InventoryAdjustedArgs) {
    super({ eventType: 'inventory.InventoryAdjusted.v1', eventVersion: 1, aggregateType: 'Existencia',
      aggregateId: args.existenciaId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { existenciaId: this.args.existenciaId, productId: this.args.productId,
      loteId: this.args.loteId, locationId: this.args.locationId,
      delta: this.args.delta, motivo: this.args.motivo, movimientoId: this.args.movimientoId };
  }
}

interface StockTransferredArgs {
  tenantId: string; productId: string; loteId: string; cantidad: number;
  origenLocationId: string; destinoLocationId: string;
  movimientoIdSalida: string; movimientoIdEntrada: string;
  correlationId?: string; userId?: string;
}

export class StockTransferred extends DomainEvent {
  constructor(private readonly args: StockTransferredArgs) {
    super({ eventType: 'inventory.StockTransferred.v1', eventVersion: 1, aggregateType: 'Lote',
      aggregateId: args.loteId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { productId: this.args.productId, loteId: this.args.loteId, cantidad: this.args.cantidad,
      origenLocationId: this.args.origenLocationId, destinoLocationId: this.args.destinoLocationId,
      movimientoIdSalida: this.args.movimientoIdSalida, movimientoIdEntrada: this.args.movimientoIdEntrada };
  }
}

interface InventoryDispatchedArgs {
  existenciaId: string; tenantId: string; productId: string; loteId: string;
  cantidad: number; referenciaTipo: string; referenciaId: string; movimientoId: string;
  correlationId?: string; userId?: string;
}

export class InventoryDispatched extends DomainEvent {
  constructor(private readonly args: InventoryDispatchedArgs) {
    super({ eventType: 'inventory.InventoryDispatched.v1', eventVersion: 1, aggregateType: 'Existencia',
      aggregateId: args.existenciaId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { existenciaId: this.args.existenciaId, productId: this.args.productId, loteId: this.args.loteId,
      cantidad: this.args.cantidad, referenciaTipo: this.args.referenciaTipo,
      referenciaId: this.args.referenciaId, movimientoId: this.args.movimientoId };
  }
}

interface StockBelowMinimumArgs {
  tenantId: string; productId: string; totalDisponible: number; minimo: number;
}

export class StockBelowMinimum extends DomainEvent {
  constructor(private readonly args: StockBelowMinimumArgs) {
    super({ eventType: 'inventory.StockBelowMinimum.v1', eventVersion: 1, aggregateType: 'StockLevel',
      aggregateId: args.productId, tenantId: args.tenantId });
  }
  payload(): Record<string, unknown> {
    return { productId: this.args.productId, totalDisponible: this.args.totalDisponible, minimo: this.args.minimo };
  }
}

// =====================================================================
// Warehouse / Location events
// =====================================================================

interface WarehouseCreatedArgs {
  warehouseId: string; tenantId: string; code: string; name: string;
  correlationId?: string; userId?: string;
}

export class WarehouseCreated extends DomainEvent {
  constructor(private readonly args: WarehouseCreatedArgs) {
    super({ eventType: 'inventory.WarehouseCreated.v1', eventVersion: 1, aggregateType: 'Warehouse',
      aggregateId: args.warehouseId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { warehouseId: this.args.warehouseId, code: this.args.code, name: this.args.name };
  }
}

interface LocationCreatedArgs {
  locationId: string; warehouseId: string; tenantId: string; code: string; name: string;
  tipoUbicacion: string; tempMinC: number | null; tempMaxC: number | null;
  correlationId?: string; userId?: string;
}

export class LocationCreated extends DomainEvent {
  constructor(private readonly args: LocationCreatedArgs) {
    super({ eventType: 'inventory.LocationCreated.v1', eventVersion: 1, aggregateType: 'Location',
      aggregateId: args.locationId, tenantId: args.tenantId, correlationId: args.correlationId, userId: args.userId });
  }
  payload(): Record<string, unknown> {
    return { locationId: this.args.locationId, warehouseId: this.args.warehouseId,
      code: this.args.code, name: this.args.name, tipoUbicacion: this.args.tipoUbicacion,
      tempMinC: this.args.tempMinC, tempMaxC: this.args.tempMaxC };
  }
}
