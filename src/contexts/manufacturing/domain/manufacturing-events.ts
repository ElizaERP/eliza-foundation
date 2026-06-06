import { DomainEvent } from '@eliza/shared-kernel/domain';

// =====================================================================
// ProductionOrderCreated
// =====================================================================

interface ProductionOrderCreatedArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  productoTerminadoId: string;
  cantidadObjetivo: number;
  componentesCount: number;
  prioridad: string;
  correlationId?: string;
  userId?: string;
}

export class ProductionOrderCreated extends DomainEvent {
  constructor(private readonly args: ProductionOrderCreatedArgs) {
    super({
      eventType: 'manufacturing.ProductionOrderCreated.v1',
      eventVersion: 1,
      aggregateType: 'OrdenProduccion',
      aggregateId: args.ordenId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      ordenId: this.args.ordenId,
      codigo: this.args.codigo,
      productoTerminadoId: this.args.productoTerminadoId,
      cantidadObjetivo: this.args.cantidadObjetivo,
      componentesCount: this.args.componentesCount,
      prioridad: this.args.prioridad,
    };
  }
}

// =====================================================================
// MaterialsReserved — MP reservada vía FEFO en Inventory
// =====================================================================

interface MaterialsReservedArgs {
  ordenId: string;
  tenantId: string;
  componentesReservados: number;
  correlationId?: string;
  userId?: string;
}

export class MaterialsReserved extends DomainEvent {
  constructor(private readonly args: MaterialsReservedArgs) {
    super({
      eventType: 'manufacturing.MaterialsReserved.v1',
      eventVersion: 1,
      aggregateType: 'OrdenProduccion',
      aggregateId: args.ordenId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      ordenId: this.args.ordenId,
      componentesReservados: this.args.componentesReservados,
    };
  }
}

// =====================================================================
// ProductionStarted
// =====================================================================

interface ProductionStartedArgs {
  ordenId: string;
  tenantId: string;
  iniciadoPor: string;
  correlationId?: string;
  userId?: string;
}

export class ProductionStarted extends DomainEvent {
  constructor(private readonly args: ProductionStartedArgs) {
    super({
      eventType: 'manufacturing.ProductionStarted.v1',
      eventVersion: 1,
      aggregateType: 'OrdenProduccion',
      aggregateId: args.ordenId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      ordenId: this.args.ordenId,
      iniciadoPor: this.args.iniciadoPor,
    };
  }
}

// =====================================================================
// MaterialsConsumed — MP despachada del inventario
// =====================================================================

interface MaterialsConsumedArgs {
  ordenId: string;
  tenantId: string;
  consumoId: string;
  productId: string;
  productCode: string;
  loteId: string;
  cantidad: number;
  correlationId?: string;
  userId?: string;
}

export class MaterialsConsumed extends DomainEvent {
  constructor(private readonly args: MaterialsConsumedArgs) {
    super({
      eventType: 'manufacturing.MaterialsConsumed.v1',
      eventVersion: 1,
      aggregateType: 'OrdenProduccion',
      aggregateId: args.ordenId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      ordenId: this.args.ordenId,
      consumoId: this.args.consumoId,
      productId: this.args.productId,
      productCode: this.args.productCode,
      loteId: this.args.loteId,
      cantidad: this.args.cantidad,
    };
  }
}

// =====================================================================
// LotProduced — lote de PT registrado en inventario
// =====================================================================

interface LotProducedArgs {
  ordenId: string;
  tenantId: string;
  loteProducidoId: string;
  loteId: string;
  codigoLote: string;
  productId: string;
  cantidad: number;
  correlationId?: string;
  userId?: string;
}

export class LotProduced extends DomainEvent {
  constructor(private readonly args: LotProducedArgs) {
    super({
      eventType: 'manufacturing.LotProduced.v1',
      eventVersion: 1,
      aggregateType: 'OrdenProduccion',
      aggregateId: args.ordenId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      ordenId: this.args.ordenId,
      loteProducidoId: this.args.loteProducidoId,
      loteId: this.args.loteId,
      codigoLote: this.args.codigoLote,
      productId: this.args.productId,
      cantidad: this.args.cantidad,
    };
  }
}

// =====================================================================
// ProductionCompleted — activa el handler stub en Inventory
// =====================================================================

interface ProductionCompletedArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  productoTerminadoId: string;
  cantidadObjetivo: number;
  cantidadRealProducida: number;
  consumosCount: number;
  lotesProducidosCount: number;
  correlationId?: string;
  userId?: string;
}

export class ProductionCompleted extends DomainEvent {
  constructor(private readonly args: ProductionCompletedArgs) {
    super({
      eventType: 'manufacturing.ProductionCompleted.v1',
      eventVersion: 1,
      aggregateType: 'OrdenProduccion',
      aggregateId: args.ordenId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      ordenId: this.args.ordenId,
      codigo: this.args.codigo,
      productoTerminadoId: this.args.productoTerminadoId,
      cantidadObjetivo: this.args.cantidadObjetivo,
      cantidadRealProducida: this.args.cantidadRealProducida,
      consumosCount: this.args.consumosCount,
      lotesProducidosCount: this.args.lotesProducidosCount,
    };
  }
}

// =====================================================================
// ProductionCancelled — libera reservas pendientes
// =====================================================================

interface ProductionCancelledArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  motivo: string;
  canceladoPor: string;
  correlationId?: string;
  userId?: string;
}

export class ProductionCancelled extends DomainEvent {
  constructor(private readonly args: ProductionCancelledArgs) {
    super({
      eventType: 'manufacturing.ProductionCancelled.v1',
      eventVersion: 1,
      aggregateType: 'OrdenProduccion',
      aggregateId: args.ordenId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      ordenId: this.args.ordenId,
      codigo: this.args.codigo,
      motivo: this.args.motivo,
      canceladoPor: this.args.canceladoPor,
    };
  }
}