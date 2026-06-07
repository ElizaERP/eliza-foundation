import { DomainEvent } from '@eliza/shared-kernel/domain';

// =====================================================================
// Customer events
// =====================================================================

interface CustomerCreatedArgs {
  clienteId: string;
  tenantId: string;
  codigo: string;
  nit: string;
  razonSocial: string;
  correlationId?: string;
  userId?: string;
}

export class CustomerCreated extends DomainEvent {
  constructor(private readonly args: CustomerCreatedArgs) {
    super({
      eventType: 'sales.CustomerCreated.v1',
      eventVersion: 1,
      aggregateType: 'Cliente',
      aggregateId: args.clienteId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      clienteId: this.args.clienteId,
      codigo: this.args.codigo,
      nit: this.args.nit,
      razonSocial: this.args.razonSocial,
    };
  }
}

interface CustomerUpdatedArgs {
  clienteId: string;
  tenantId: string;
  codigo: string;
  cambios: string[];
  correlationId?: string;
  userId?: string;
}

export class CustomerUpdated extends DomainEvent {
  constructor(private readonly args: CustomerUpdatedArgs) {
    super({
      eventType: 'sales.CustomerUpdated.v1',
      eventVersion: 1,
      aggregateType: 'Cliente',
      aggregateId: args.clienteId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      clienteId: this.args.clienteId,
      codigo: this.args.codigo,
      cambios: this.args.cambios,
    };
  }
}

// =====================================================================
// Sales Order events
// =====================================================================

interface OrderDraftedArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  clienteId: string;
  clienteCodigo: string;
  correlationId?: string;
  userId?: string;
}

export class OrderDrafted extends DomainEvent {
  constructor(private readonly args: OrderDraftedArgs) {
    super({
      eventType: 'sales.OrderDrafted.v1',
      eventVersion: 1,
      aggregateType: 'OrdenVenta',
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
      clienteId: this.args.clienteId,
      clienteCodigo: this.args.clienteCodigo,
    };
  }
}

interface OrderConfirmedArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  clienteId: string;
  lineasCount: number;
  totalBruto: number;
  correlationId?: string;
  userId?: string;
}

export class OrderConfirmed extends DomainEvent {
  constructor(private readonly args: OrderConfirmedArgs) {
    super({
      eventType: 'sales.OrderConfirmed.v1',
      eventVersion: 1,
      aggregateType: 'OrdenVenta',
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
      clienteId: this.args.clienteId,
      lineasCount: this.args.lineasCount,
      totalBruto: this.args.totalBruto,
    };
  }
}

interface OrderReservedArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  lineasReservadas: number;
  correlationId?: string;
  userId?: string;
}

export class OrderReserved extends DomainEvent {
  constructor(private readonly args: OrderReservedArgs) {
    super({
      eventType: 'sales.OrderReserved.v1',
      eventVersion: 1,
      aggregateType: 'OrdenVenta',
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
      lineasReservadas: this.args.lineasReservadas,
    };
  }
}

interface OrderDispatchedArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  clienteId: string;
  totalDespachado: number;
  movimientoIds: string[];
  correlationId?: string;
  userId?: string;
}

export class OrderDispatched extends DomainEvent {
  constructor(private readonly args: OrderDispatchedArgs) {
    super({
      eventType: 'sales.OrderDispatched.v1',
      eventVersion: 1,
      aggregateType: 'OrdenVenta',
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
      clienteId: this.args.clienteId,
      totalDespachado: this.args.totalDespachado,
      movimientoIds: this.args.movimientoIds,
    };
  }
}

interface OrderCancelledArgs {
  ordenId: string;
  tenantId: string;
  codigo: string;
  motivo: string;
  canceladoPor: string;
  reservasLiberadas: boolean;
  correlationId?: string;
  userId?: string;
}

export class OrderCancelled extends DomainEvent {
  constructor(private readonly args: OrderCancelledArgs) {
    super({
      eventType: 'sales.OrderCancelled.v1',
      eventVersion: 1,
      aggregateType: 'OrdenVenta',
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
      reservasLiberadas: this.args.reservasLiberadas,
    };
  }
}