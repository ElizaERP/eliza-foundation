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

// --- Manufacturing domain ---
import {
  ComponenteBomSnapshot,
  EstadoOrdenProduccion,
  ORDEN_PRODUCCION_REPOSITORY,
  OrdenDeProduccion,
  OrdenProduccionFilter,
  OrdenProduccionId,
  OrdenProduccionRepository,
  PrioridadProduccion,
} from '@eliza/contexts/manufacturing/domain';
import {
  OrdenProduccionListView,
  OrdenProduccionView,
  toOrdenProduccionListView,
  toOrdenProduccionView,
} from '@eliza/contexts/manufacturing/application/dto/manufacturing.views';

// --- Catalog domain (lectura de BOM) ---
import {
  PRODUCT_REPOSITORY,
  ProductRepository,
} from '@eliza/contexts/catalog/domain';

// --- Inventory application (cross-BC) ---
import {
  ReceiveInventoryUseCase,
  RegisterLotUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
} from '@eliza/contexts/inventory/application';
import { OrigenLote, TipoReferencia } from '@eliza/contexts/inventory/domain';

// =====================================================================
// 1. CreateProductionOrder
// =====================================================================

export interface CreateProductionOrderInput {
  codigo: string;
  productoTerminadoId: string;
  cantidadObjetivo: number;
  prioridad?: PrioridadProduccion;
  fechaProgramada?: Date;
  notas?: string;
}

@Injectable()
export class CreateProductionOrderUseCase
  implements UseCase<CreateProductionOrderInput, OrdenProduccionView>
{
  private readonly logger = new Logger(CreateProductionOrderUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateProductionOrderInput): Promise<Result<OrdenProduccionView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const now = this.clock.now();

    // Validar unicidad del código
    const existing = await this.repo.findByCodigo(input.codigo);
    if (existing) {
      return err(applicationError('manufacturing.codigo_exists',
        `Production order with code ${input.codigo} already exists`, 'conflict'));
    }

    // Obtener producto terminado del catálogo
    const product = await this.productRepo.findById(input.productoTerminadoId);
    if (!product) {
      return err(applicationError('manufacturing.product_not_found',
        `Product ${input.productoTerminadoId} not found`, 'not_found'));
    }

    // Validar que tenga BOM
    const bomComponents = product.components ?? [];
    if (bomComponents.length === 0) {
      return err(applicationError('manufacturing.no_bom',
        `Product ${product.code} has no BOM components defined`, 'validation'));
    }

    // Capturar snapshot del BOM × cantidadObjetivo
    const componentes: ComponenteBomSnapshot[] = bomComponents.map((bom: any) => ({
      productId: bom.componentProductId,
      productCode: bom.componentProduct?.code ?? bom.componentProductId,
      productName: bom.componentProduct?.name ?? bom.componentProductId,
      cantidadPorUnidad: Number(bom.quantity),
      cantidadTotalRequerida: Math.round(Number(bom.quantity) * input.cantidadObjetivo * 1_000_000) / 1_000_000,
      unidadMedida: bom.unitOfMeasure?.symbol ?? bom.unitOfMeasure?.code ?? 'un',
    }));

    const ordenR = OrdenDeProduccion.create({
      tenantId,
      codigo: input.codigo,
      productoTerminadoId: input.productoTerminadoId,
      productoTerminadoCode: product.code,
      productoTerminadoName: product.name,
      cantidadObjetivo: input.cantidadObjetivo,
      prioridad: input.prioridad,
      componentes,
      fechaProgramada: input.fechaProgramada,
      notas: input.notas,
      now,
    });
    if (ordenR.isErr) {
      return err(applicationError(ordenR.error.code, ordenR.error.message, 'validation'));
    }

    await this.repo.save(ordenR.value);
    this.logger.log(`Production order ${input.codigo} created for ${product.code} × ${input.cantidadObjetivo}`);
    return ok(toOrdenProduccionView(ordenR.value));
  }
}

// =====================================================================
// 2. ReserveMaterialsForOrder — FEFO multi-componente
// =====================================================================

export interface ReserveMaterialsInput { ordenId: string; }

export interface ReserveMaterialsOutput {
  ordenId: string;
  componentesReservados: number;
  detalle: Array<{ productCode: string; cantidadReservada: number; reservaIds: string[] }>;
}

@Injectable()
export class ReserveMaterialsUseCase
  implements UseCase<ReserveMaterialsInput, ReserveMaterialsOutput>
{
  private readonly logger = new Logger(ReserveMaterialsUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    private readonly reserveStock: ReserveStockUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ReserveMaterialsInput): Promise<Result<ReserveMaterialsOutput, ApplicationError>> {
    this.ctx.tryGetTenantId();
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }
    if (orden.estado !== EstadoOrdenProduccion.Planificada) {
      return err(applicationError('manufacturing.invalid_state',
        `Cannot reserve materials in state ${orden.estado}`, 'validation'));
    }

    const detalle: ReserveMaterialsOutput['detalle'] = [];

    for (const comp of orden.componentes) {
      // Referencia única por (orden, componente) para que cada componente
      // tenga su propia reserva independiente en Inventory
      const referenciaId = `${orden.id.value}:${comp.productId}`;

      const reserveR = await this.reserveStock.execute({
        productId: comp.productId,
        cantidad: comp.cantidadTotalRequerida,
        referenciaTipo: TipoReferencia.ProductionOrder,
        referenciaId,
      });

      if (reserveR.isErr) {
        // Si falla un componente, reportar cuál falló
        return err(applicationError('manufacturing.reserve_failed',
          `Failed to reserve ${comp.productCode}: ${reserveR.error.message}`,
          reserveR.error.category ?? 'conflict'));
      }

      detalle.push({
        productCode: comp.productCode,
        cantidadReservada: reserveR.value.totalAsignado,
        reservaIds: reserveR.value.reservaIds,
      });
    }

    // Marcar la orden como materialesReservados
    const markR = orden.markMaterialsReserved({ now });
    if (markR.isErr) {
      return err(applicationError(markR.error.code, markR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    this.logger.log(`Reserved materials for order ${orden.codigo}: ${detalle.length} components`);

    return ok({
      ordenId: orden.id.value,
      componentesReservados: detalle.length,
      detalle,
    });
  }
}

// =====================================================================
// 3. StartProduction
// =====================================================================

export interface StartProductionInput { ordenId: string; }

@Injectable()
export class StartProductionUseCase
  implements UseCase<StartProductionInput, OrdenProduccionView>
{
  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: StartProductionInput): Promise<Result<OrdenProduccionView, ApplicationError>> {
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }

    const startR = orden.start({ iniciadoPor: userId, now });
    if (startR.isErr) {
      return err(applicationError(startR.error.code, startR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    return ok(toOrdenProduccionView(orden));
  }
}

// =====================================================================
// 4. RecordConsumption — registro de MP consumida (trazabilidad)
// =====================================================================

export interface RecordConsumptionInput {
  ordenId: string;
  productId: string;
  productCode: string;
  loteId: string;
  codigoLote: string;
  cantidad: number;
  unidadMedida: string;
  movimientoId: string;
}

@Injectable()
export class RecordConsumptionUseCase
  implements UseCase<RecordConsumptionInput, OrdenProduccionView>
{
  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: RecordConsumptionInput): Promise<Result<OrdenProduccionView, ApplicationError>> {
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }

    const consumoR = orden.recordConsumption({
      productId: input.productId,
      productCode: input.productCode,
      loteId: input.loteId,
      codigoLote: input.codigoLote,
      cantidad: input.cantidad,
      unidadMedida: input.unidadMedida,
      movimientoId: input.movimientoId,
      now,
    });
    if (consumoR.isErr) {
      return err(applicationError(consumoR.error.code, consumoR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    return ok(toOrdenProduccionView(orden));
  }
}

// =====================================================================
// 5. RecordProduction — crea Lote PT en Inventory
// =====================================================================

export interface RecordProductionInput {
  ordenId: string;
  codigoLote: string;
  cantidad: number;
  fechaVencimiento: Date;
  locationId: string;
  notas?: string;
}

@Injectable()
export class RecordProductionUseCase
  implements UseCase<RecordProductionInput, OrdenProduccionView>
{
  private readonly logger = new Logger(RecordProductionUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    private readonly registerLot: RegisterLotUseCase,
    private readonly receiveInventory: ReceiveInventoryUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: RecordProductionInput): Promise<Result<OrdenProduccionView, ApplicationError>> {
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }
    if (orden.estado !== EstadoOrdenProduccion.EnProceso) {
      return err(applicationError('manufacturing.must_be_en_proceso',
        `Cannot record production in state ${orden.estado}`, 'validation'));
    }

    // 1. Crear Lote PT en Inventory
    const lotR = await this.registerLot.execute({
      codigoLote: input.codigoLote,
      productId: orden.productoTerminadoId,
      fechaProduccion: now,
      fechaVencimiento: input.fechaVencimiento,
      cantidadInicial: input.cantidad,
      origenTipo: OrigenLote.Production,
      origenRef: orden.id.value,
      notas: input.notas ?? `Producido por orden ${orden.codigo}`,
    });
    if (lotR.isErr) {
      return err(applicationError('manufacturing.lot_creation_failed',
        `Failed to create lot: ${lotR.error.message}`, lotR.error.category ?? 'validation'));
    }

    const newLoteId = lotR.value.id;

    // 2. Recibir stock en ubicación destino
    const recR = await this.receiveInventory.execute({
      productId: orden.productoTerminadoId,
      loteId: newLoteId,
      locationId: input.locationId,
      cantidad: input.cantidad,
      referenciaTipo: TipoReferencia.ProductionOrder,
      referenciaId: orden.id.value,
    });
    if (recR.isErr) {
      return err(applicationError('manufacturing.receive_failed',
        `Failed to receive inventory: ${recR.error.message}`, recR.error.category ?? 'validation'));
    }

    // 3. Registrar en el aggregate
    const prodR = orden.recordProduction({
      loteId: newLoteId,
      codigoLote: input.codigoLote,
      productId: orden.productoTerminadoId,
      cantidad: input.cantidad,
      locationId: input.locationId,
      movimientoId: recR.value.movimientoId,
      now,
    });
    if (prodR.isErr) {
      return err(applicationError(prodR.error.code, prodR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    this.logger.log(`Produced ${input.cantidad} units of ${orden.productoTerminadoCode} for order ${orden.codigo}`);
    return ok(toOrdenProduccionView(orden));
  }
}

// =====================================================================
// 6. CompleteProductionOrder
// =====================================================================

export interface CompleteProductionOrderInput { ordenId: string; }

@Injectable()
export class CompleteProductionOrderUseCase
  implements UseCase<CompleteProductionOrderInput, OrdenProduccionView>
{
  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: CompleteProductionOrderInput): Promise<Result<OrdenProduccionView, ApplicationError>> {
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }

    const complR = orden.complete({ now });
    if (complR.isErr) {
      return err(applicationError(complR.error.code, complR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    return ok(toOrdenProduccionView(orden));
  }
}

// =====================================================================
// 7. CancelProductionOrder — libera reservas pendientes
// =====================================================================

export interface CancelProductionOrderInput {
  ordenId: string;
  motivo: string;
}

@Injectable()
export class CancelProductionOrderUseCase
  implements UseCase<CancelProductionOrderInput, OrdenProduccionView>
{
  private readonly logger = new Logger(CancelProductionOrderUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    private readonly releaseReservation: ReleaseReservationUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CancelProductionOrderInput): Promise<Result<OrdenProduccionView, ApplicationError>> {
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }

    // Liberar reservas en Inventory si estaban reservadas
    if (orden.materialesReservados && orden.estado === EstadoOrdenProduccion.Planificada) {
      for (const comp of orden.componentes) {
        const referenciaId = `${orden.id.value}:${comp.productId}`;
        const relR = await this.releaseReservation.execute({
          productId: comp.productId,
          referenciaTipo: TipoReferencia.ProductionOrder,
          referenciaId,
          reason: `Production order ${orden.codigo} cancelled: ${input.motivo}`,
        });
        if (relR.isErr) {
          this.logger.warn(`Could not release reservation for ${comp.productCode}: ${relR.error.message}`);
          // No falla la cancelación — loguea y continúa
        }
      }
    }

    const cancelR = orden.cancel({ motivo: input.motivo, canceladoPor: userId, now });
    if (cancelR.isErr) {
      return err(applicationError(cancelR.error.code, cancelR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    this.logger.log(`Production order ${orden.codigo} cancelled: ${input.motivo}`);
    return ok(toOrdenProduccionView(orden));
  }
}

// =====================================================================
// 8a. GetProductionOrderById
// =====================================================================

@Injectable()
export class GetProductionOrderByIdUseCase
  implements UseCase<{ ordenId: string }, OrdenProduccionView | null>
{
  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
  ) {}

  async execute(input: { ordenId: string }): Promise<Result<OrdenProduccionView | null, ApplicationError>> {
    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) return ok(null);
    return ok(toOrdenProduccionView(orden));
  }
}

// =====================================================================
// 8b. ListProductionOrders
// =====================================================================

export interface ListProductionOrdersInput {
  estado?: EstadoOrdenProduccion;
  productoTerminadoId?: string;
  prioridad?: PrioridadProduccion;
  limit?: number;
  offset?: number;
}

export interface ListProductionOrdersOutput {
  items: OrdenProduccionListView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class ListProductionOrdersUseCase
  implements UseCase<ListProductionOrdersInput, ListProductionOrdersOutput>
{
  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
  ) {}

  async execute(input: ListProductionOrdersInput): Promise<Result<ListProductionOrdersOutput, ApplicationError>> {
    const filter: OrdenProduccionFilter = {
      estado: input.estado,
      productoTerminadoId: input.productoTerminadoId,
      prioridad: input.prioridad,
      limit: Math.min(input.limit ?? 50, 200),
      offset: input.offset ?? 0,
    };
    const [items, total] = await Promise.all([
      this.repo.list(filter),
      this.repo.countBy(filter),
    ]);
    return ok({
      items: items.map(toOrdenProduccionListView),
      total,
      limit: filter.limit,
      offset: filter.offset,
    });
  }
}