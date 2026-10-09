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

// --- Sales domain ---
import {
  CLIENTE_REPOSITORY,
  ClienteId,
  ClienteRepository,
  CondicionesPago,
  EstadoOrdenVenta,
  ORDEN_VENTA_REPOSITORY,
  OrdenDeVenta,
  OrdenVentaFilter,
  OrdenVentaId,
  OrdenVentaRepository,
} from '@eliza/contexts/sales/domain';
import {
  OrdenVentaListView,
  OrdenVentaView,
  toOrdenVentaListView,
  toOrdenVentaView,
} from '@eliza/contexts/sales/application/dto/sales.views';

// --- Catalog domain (validar productos) ---
import {
  PRODUCT_REPOSITORY,
  ProductRepository,
} from '@eliza/contexts/catalog/domain';

// --- Inventory application (cross-BC) ---
import {
  DispatchInventoryUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
} from '@eliza/contexts/inventory/application';
import { TipoReferencia } from '@eliza/contexts/inventory/domain';

// =====================================================================
// 1. CreateSalesOrder
// =====================================================================

export interface CreateSalesOrderInput {
  codigo: string;
  clienteId: string;
  condicionesPago?: CondicionesPago;
  direccionEntrega?: {
    direccion: string;
    ciudad: string;
    departamento: string;
    telefono?: string;
    notas?: string;
  };
  notas?: string;
}

@Injectable()
export class CreateSalesOrderUseCase
  implements UseCase<CreateSalesOrderInput, OrdenVentaView>
{
  private readonly logger = new Logger(CreateSalesOrderUseCase.name);

  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    @Inject(CLIENTE_REPOSITORY) private readonly clienteRepo: ClienteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateSalesOrderInput): Promise<Result<OrdenVentaView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const now = this.clock.now();

    // Validar unicidad del código
    const existing = await this.repo.findByCodigo(input.codigo);
    if (existing) {
      return err(applicationError('sales.order_code_exists',
        `Sales order with code ${input.codigo} already exists`, 'conflict'));
    }

    // Validar que el cliente exista y pueda recibir pedidos
    const cliente = await this.clienteRepo.findById(ClienteId.fromString(input.clienteId));
    if (!cliente) {
      return err(applicationError('sales.customer_not_found',
        `Customer ${input.clienteId} not found`, 'not_found'));
    }
    if (!cliente.puedeRecibirPedidos()) {
      return err(applicationError('sales.customer_suspended',
        `Customer ${cliente.codigo} is ${cliente.estado} and cannot receive orders`, 'validation'));
    }

    // Dirección de entrega: si no la envían, usar la del cliente
    const dirEntrega = input.direccionEntrega ?? {
      direccion: cliente.direccionDespacho.direccion,
      ciudad: cliente.direccionDespacho.ciudad,
      departamento: cliente.direccionDespacho.departamento,
      telefono: cliente.direccionDespacho.telefono ?? undefined,
      notas: cliente.direccionDespacho.notas ?? undefined,
    };

    const ordenR = OrdenDeVenta.create({
      tenantId,
      codigo: input.codigo,
      clienteId: cliente.id.value,
      clienteCodigo: cliente.codigo,
      clienteRazonSocial: cliente.razonSocial,
      condicionesPago: input.condicionesPago ?? cliente.condicionesPago,
      direccionEntrega: dirEntrega,
      notas: input.notas,
      now,
    });
    if (ordenR.isErr) {
      return err(applicationError(ordenR.error.code, ordenR.error.message, 'validation'));
    }

    await this.repo.save(ordenR.value);
    this.logger.log(`Sales order ${input.codigo} created for customer ${cliente.codigo}`);
    return ok(toOrdenVentaView(ordenR.value));
  }
}

// =====================================================================
// 2. AddOrderLine
// =====================================================================

export interface AddOrderLineInput {
  ordenId: string;
  productId: string;
  cantidad: number;
  /** Opcional: sin él se usa el precio de lista del producto. */
  precioUnitario?: number;
  /** true si quien agrega la línea puede fijar el precio (gerente/admin); el vendedor no. */
  puedeFijarPrecio?: boolean;
  notas?: string;
}

@Injectable()
export class AddOrderLineUseCase implements UseCase<AddOrderLineInput, OrdenVentaView> {
  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: AddOrderLineInput): Promise<Result<OrdenVentaView, ApplicationError>> {
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('sales.order_not_found',
        `Sales order ${input.ordenId} not found`, 'not_found'));
    }

    // Validar producto en catálogo
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      return err(applicationError('sales.product_not_found',
        `Product ${input.productId} not found`, 'not_found'));
    }

    const tasaIva = product.taxRate !== undefined && product.taxRate !== null
      ? Number(product.taxRate)
      : 0;

    // Precio: el de lista del catálogo. Solo quien puede fijar precio (gerente/admin) puede
    // enviar otro; un vendedor que lo intente recibe un error en lugar de un precio ignorado.
    if (input.precioUnitario !== undefined && !input.puedeFijarPrecio) {
      return err(applicationError('sales.price_not_allowed',
        'El precio lo define la lista de precios del catálogo; tu rol no puede fijarlo', 'validation'));
    }
    const precioUnitario = input.precioUnitario ?? product.salePrice;
    if (precioUnitario === null || precioUnitario === undefined) {
      return err(applicationError('sales.product_without_price',
        `El producto ${product.code} no tiene precio de lista; pídeselo al gerente de ventas`, 'validation'));
    }

    const lineaR = orden.addLine({
      productId: product.id.value,
      productCode: product.code,
      productName: product.name,
      cantidad: input.cantidad,
      precioUnitario,
      tasaIva,
      notas: input.notas,
      now,
    });
    if (lineaR.isErr) {
      return err(applicationError(lineaR.error.code, lineaR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    return ok(toOrdenVentaView(orden));
  }
}

// =====================================================================
// 3. RemoveOrderLine
// =====================================================================

export interface RemoveOrderLineInput {
  ordenId: string;
  lineaId: string;
}

@Injectable()
export class RemoveOrderLineUseCase implements UseCase<RemoveOrderLineInput, OrdenVentaView> {
  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: RemoveOrderLineInput): Promise<Result<OrdenVentaView, ApplicationError>> {
    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('sales.order_not_found',
        `Sales order ${input.ordenId} not found`, 'not_found'));
    }

    const removeR = orden.removeLine({ lineaId: input.lineaId, now: this.clock.now() });
    if (removeR.isErr) {
      return err(applicationError(removeR.error.code, removeR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    return ok(toOrdenVentaView(orden));
  }
}

// =====================================================================
// 4. ConfirmOrder — cierra líneas, emite OrderConfirmed
// =====================================================================

@Injectable()
export class ConfirmOrderUseCase implements UseCase<{ ordenId: string }, OrdenVentaView> {
  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { ordenId: string }): Promise<Result<OrdenVentaView, ApplicationError>> {
    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('sales.order_not_found',
        `Sales order ${input.ordenId} not found`, 'not_found'));
    }

    const confirmR = orden.confirm({ now: this.clock.now() });
    if (confirmR.isErr) {
      return err(applicationError(confirmR.error.code, confirmR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    return ok(toOrdenVentaView(orden));
  }
}

// =====================================================================
// 5. ReserveOrderStock — reserva FEFO por cada línea
// =====================================================================

export interface ReserveOrderStockOutput {
  ordenId: string;
  lineasReservadas: number;
  detalle: Array<{
    productCode: string;
    cantidadReservada: number;
    reservaIds: string[];
  }>;
}

@Injectable()
export class ReserveOrderStockUseCase
  implements UseCase<{ ordenId: string }, ReserveOrderStockOutput>
{
  private readonly logger = new Logger(ReserveOrderStockUseCase.name);

  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    private readonly reserveStock: ReserveStockUseCase,
    private readonly releaseReservation: ReleaseReservationUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  /**
   * Reserva todas las líneas o ninguna. Si una línea no alcanza, se liberan las
   * reservas que ya se hicieron en este intento (compensación) y el pedido queda
   * en Confirmada, listo para reintentar cuando haya stock. Antes de empezar se
   * liberan reservas que hubiera dejado un intento anterior interrumpido, para
   * que reintentar nunca reserve dos veces lo mismo.
   */
  async execute(input: { ordenId: string }): Promise<Result<ReserveOrderStockOutput, ApplicationError>> {
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('sales.order_not_found',
        `Sales order ${input.ordenId} not found`, 'not_found'));
    }
    if (orden.estado !== EstadoOrdenVenta.Confirmada) {
      return err(applicationError('sales.must_be_confirmed',
        `El pedido debe estar Confirmado para reservar stock (estado actual: ${orden.estado}).`, 'validation'));
    }

    const ref = (productId: string) => `${orden.id.value}:${productId}`;
    const liberar = async (productId: string, reason: string) => {
      // not_found = no había reservas para esa línea: no es un error aquí.
      await this.releaseReservation.execute({
        productId, referenciaTipo: TipoReferencia.SalesOrder, referenciaId: ref(productId), reason,
      });
    };

    // Limpieza: reservas huérfanas de un intento anterior que quedó a medias.
    for (const linea of orden.lineas) {
      await liberar(linea.productId, `Sales order ${orden.codigo}: limpieza antes de reservar`);
    }

    const detalle: ReserveOrderStockOutput['detalle'] = [];
    const reservadas: string[] = [];

    for (const linea of orden.lineas) {
      const reserveR = await this.reserveStock.execute({
        productId: linea.productId,
        cantidad: linea.cantidad,
        referenciaTipo: TipoReferencia.SalesOrder,
        referenciaId: ref(linea.productId),
      });

      if (reserveR.isErr) {
        // Compensación: todo o nada.
        for (const productId of reservadas) {
          await liberar(productId, `Sales order ${orden.codigo}: reserva incompleta, se deshace`);
        }
        const sinStock = reserveR.error.category === 'conflict';
        this.logger.warn(`Reserve failed for ${orden.codigo} at ${linea.productCode}: ${reserveR.error.code}; released ${reservadas.length} line(s)`);
        return err(applicationError(
          sinStock ? 'sales.insufficient_stock' : 'sales.reserve_failed',
          sinStock
            ? `No hay stock suficiente de ${linea.productName} (${linea.productCode}) para reservar ${linea.cantidad}. No se reservó ninguna línea del pedido.`
            : `No se pudo reservar ${linea.productName} (${linea.productCode}): ${reserveR.error.message}. No se reservó ninguna línea del pedido.`,
          sinStock ? 'conflict' : (reserveR.error.category ?? 'validation'),
          { productCode: linea.productCode, cantidad: linea.cantidad, causa: reserveR.error.code },
        ));
      }

      reservadas.push(linea.productId);
      detalle.push({
        productCode: linea.productCode,
        cantidadReservada: reserveR.value.totalAsignado,
        reservaIds: reserveR.value.reservaIds,
      });
    }

    const markR = orden.markReserved({ now });
    if (markR.isErr) {
      for (const productId of reservadas) {
        await liberar(productId, `Sales order ${orden.codigo}: no se pudo marcar como reservado`);
      }
      return err(applicationError(markR.error.code, markR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    this.logger.log(`Reserved stock for order ${orden.codigo}: ${detalle.length} lines`);

    return ok({
      ordenId: orden.id.value,
      lineasReservadas: detalle.length,
      detalle,
    });
  }
}

// =====================================================================
// 6. DispatchOrder — despacha el stock reservado
// =====================================================================

export interface DispatchOrderOutput {
  ordenId: string;
  totalDespachado: number;
  movimientoIds: string[];
}

@Injectable()
export class DispatchOrderUseCase
  implements UseCase<{ ordenId: string }, DispatchOrderOutput>
{
  private readonly logger = new Logger(DispatchOrderUseCase.name);

  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    private readonly dispatchInventory: DispatchInventoryUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { ordenId: string }): Promise<Result<DispatchOrderOutput, ApplicationError>> {
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('sales.order_not_found',
        `Sales order ${input.ordenId} not found`, 'not_found'));
    }
    if (orden.estado !== EstadoOrdenVenta.Reservada) {
      return err(applicationError('sales.must_be_reserved',
        `Order must be in Reservada state to dispatch (current: ${orden.estado})`, 'validation'));
    }

    let totalDespachado = 0;
    const allMovimientoIds: string[] = [];

    for (const linea of orden.lineas) {
      const referenciaId = `${orden.id.value}:${linea.productId}`;

      const dispR = await this.dispatchInventory.execute({
        productId: linea.productId,
        referenciaTipo: TipoReferencia.SalesOrder,
        referenciaId,
      });

      if (dispR.isErr) {
        return err(applicationError('sales.dispatch_failed',
          `Failed to dispatch ${linea.productCode}: ${dispR.error.message}`,
          dispR.error.category ?? 'validation'));
      }

      totalDespachado += dispR.value.totalDespachado;
      allMovimientoIds.push(...dispR.value.movimientoIds);
    }

    const markR = orden.markDispatched({ movimientoIds: allMovimientoIds, now });
    if (markR.isErr) {
      return err(applicationError(markR.error.code, markR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    this.logger.log(`Dispatched order ${orden.codigo}: ${totalDespachado} units`);

    return ok({
      ordenId: orden.id.value,
      totalDespachado,
      movimientoIds: allMovimientoIds,
    });
  }
}

// =====================================================================
// 7. CancelOrder — libera reservas si las hay
// =====================================================================

export interface CancelOrderInput {
  ordenId: string;
  motivo: string;
}

@Injectable()
export class CancelOrderUseCase implements UseCase<CancelOrderInput, OrdenVentaView> {
  private readonly logger = new Logger(CancelOrderUseCase.name);

  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    private readonly releaseReservation: ReleaseReservationUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CancelOrderInput): Promise<Result<OrdenVentaView, ApplicationError>> {
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('sales.order_not_found',
        `Sales order ${input.ordenId} not found`, 'not_found'));
    }

    // Liberar reservas si el pedido está en Reservada
    let reservasLiberadas = false;
    if (orden.estado === EstadoOrdenVenta.Reservada) {
      for (const linea of orden.lineas) {
        const referenciaId = `${orden.id.value}:${linea.productId}`;
        const relR = await this.releaseReservation.execute({
          productId: linea.productId,
          referenciaTipo: TipoReferencia.SalesOrder,
          referenciaId,
          reason: `Sales order ${orden.codigo} cancelled: ${input.motivo}`,
        });
        if (relR.isErr) {
          this.logger.warn(`Could not release reservation for ${linea.productCode}: ${relR.error.message}`);
        }
      }
      reservasLiberadas = true;
    }

    const cancelR = orden.cancel({
      motivo: input.motivo,
      canceladoPor: userId,
      reservasLiberadas,
      now,
    });
    if (cancelR.isErr) {
      return err(applicationError(cancelR.error.code, cancelR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    this.logger.log(`Sales order ${orden.codigo} cancelled: ${input.motivo}`);
    return ok(toOrdenVentaView(orden));
  }
}

// =====================================================================
// 8. CloseOrder
// =====================================================================

@Injectable()
export class CloseOrderUseCase implements UseCase<{ ordenId: string }, OrdenVentaView> {
  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { ordenId: string }): Promise<Result<OrdenVentaView, ApplicationError>> {
    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('sales.order_not_found',
        `Sales order ${input.ordenId} not found`, 'not_found'));
    }

    const closeR = orden.close({ now: this.clock.now() });
    if (closeR.isErr) {
      return err(applicationError(closeR.error.code, closeR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    return ok(toOrdenVentaView(orden));
  }
}

// =====================================================================
// 9. GetSalesOrderById
// =====================================================================

@Injectable()
export class GetSalesOrderByIdUseCase
  implements UseCase<{ ordenId: string }, OrdenVentaView | null>
{
  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
  ) {}

  async execute(input: { ordenId: string }): Promise<Result<OrdenVentaView | null, ApplicationError>> {
    const orden = await this.repo.findById(OrdenVentaId.fromString(input.ordenId));
    if (!orden) return ok(null);
    return ok(toOrdenVentaView(orden));
  }
}

// =====================================================================
// 10. ListSalesOrders
// =====================================================================

export interface ListSalesOrdersInput {
  estado?: EstadoOrdenVenta;
  clienteId?: string;
  creadoDesde?: Date;
  creadoHasta?: Date;
  limit?: number;
  offset?: number;
}

export interface ListSalesOrdersOutput {
  items: OrdenVentaListView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class ListSalesOrdersUseCase
  implements UseCase<ListSalesOrdersInput, ListSalesOrdersOutput>
{
  constructor(
    @Inject(ORDEN_VENTA_REPOSITORY) private readonly repo: OrdenVentaRepository,
  ) {}

  async execute(input: ListSalesOrdersInput): Promise<Result<ListSalesOrdersOutput, ApplicationError>> {
    const filter: OrdenVentaFilter = {
      estado: input.estado,
      clienteId: input.clienteId,
      creadoDesde: input.creadoDesde,
      creadoHasta: input.creadoHasta,
      limit: Math.min(input.limit ?? 50, 200),
      offset: input.offset ?? 0,
    };
    const [items, total] = await Promise.all([
      this.repo.list(filter),
      this.repo.countBy(filter),
    ]);
    return ok({
      items: items.map(toOrdenVentaListView),
      total,
      limit: filter.limit,
      offset: filter.offset,
    });
  }
}