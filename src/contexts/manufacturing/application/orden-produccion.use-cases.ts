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
  UNIT_OF_MEASURE_REPOSITORY,
  UnitOfMeasureRepository,
} from '@eliza/contexts/catalog/domain';

// --- Inventory application (cross-BC) ---
import {
  DispatchInventoryUseCase,
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
  /** Lo pone CreateJornada; desde la API de órdenes sueltas no se envía. */
  jornada?: string;
}

@Injectable()
export class CreateProductionOrderUseCase
  implements UseCase<CreateProductionOrderInput, OrdenProduccionView>
{
  private readonly logger = new Logger(CreateProductionOrderUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: ProductRepository,
    @Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly uomRepo: UnitOfMeasureRepository,
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
        `${product.name} no tiene receta: defínela en Catálogo antes de producirlo.`, 'validation', { productCode: product.code }));
    }

    // Capturar snapshot del BOM × cantidadObjetivo.
    // product.components son entidades de dominio del Catálogo (BOMComponent): el id del
    // componente y la unidad son value objects y la cantidad es un Quantity, así que el
    // código, nombre y símbolo se resuelven con los repositorios del Catálogo.
    const componentIds = bomComponents.map((c) => c.componentProductId.value);
    const uomIds = [...new Set(bomComponents.map((c) => c.uomId.value))];
    const [componentProducts, uoms] = await Promise.all([
      this.productRepo.findByIds(componentIds),
      this.uomRepo.findByIds(uomIds),
    ]);
    const productById = new Map(componentProducts.map((p) => [p.id.value, p]));
    const uomById = new Map(uoms.map((u) => [u.id.value, u]));

    const componentes: ComponenteBomSnapshot[] = bomComponents.map((bom) => {
      const componentId = bom.componentProductId.value;
      const componentProduct = productById.get(componentId);
      const uom = uomById.get(bom.uomId.value);
      const cantidadPorUnidad = bom.quantity.amount;
      return {
        productId: componentId,
        productCode: componentProduct?.code ?? componentId,
        productName: componentProduct?.name ?? componentId,
        cantidadPorUnidad,
        cantidadTotalRequerida: Math.round(cantidadPorUnidad * input.cantidadObjetivo * 1_000_000) / 1_000_000,
        unidadMedida: uom?.symbol ?? uom?.code ?? 'un',
      };
    });

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
      jornada: input.jornada,
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
    private readonly releaseReservation: ReleaseReservationUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  /**
   * Reserva todas las materias primas o ninguna (igual que los pedidos de venta):
   * si un componente no alcanza, se liberan las reservas ya hechas y la orden sigue
   * Planificada sin materiales. Antes de empezar se liberan reservas huérfanas de
   * un intento anterior interrumpido, para no reservar dos veces.
   */
  async execute(input: ReserveMaterialsInput): Promise<Result<ReserveMaterialsOutput, ApplicationError>> {
    this.ctx.tryGetTenantId();
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }
    if (orden.estado !== EstadoOrdenProduccion.Planificada || orden.materialesReservados) {
      return err(applicationError('manufacturing.invalid_state',
        orden.materialesReservados
          ? 'Los materiales de esta orden ya están reservados.'
          : `Solo se reservan materiales de una orden Planificada (estado actual: ${orden.estado}).`,
        'validation'));
    }

    // Referencia única por (orden, componente): cada componente tiene su propia reserva.
    const ref = (productId: string) => `${orden.id.value}:${productId}`;
    const liberar = async (productId: string, reason: string) => {
      await this.releaseReservation.execute({
        productId, referenciaTipo: TipoReferencia.ProductionOrder, referenciaId: ref(productId), reason,
      });
    };

    for (const comp of orden.componentes) {
      await liberar(comp.productId, `Production order ${orden.codigo}: limpieza antes de reservar`);
    }

    const detalle: ReserveMaterialsOutput['detalle'] = [];
    const reservados: string[] = [];

    for (const comp of orden.componentes) {
      const reserveR = await this.reserveStock.execute({
        productId: comp.productId,
        cantidad: comp.cantidadTotalRequerida,
        referenciaTipo: TipoReferencia.ProductionOrder,
        referenciaId: ref(comp.productId),
      });

      if (reserveR.isErr) {
        for (const productId of reservados) {
          await liberar(productId, `Production order ${orden.codigo}: reserva incompleta, se deshace`);
        }
        const sinStock = reserveR.error.category === 'conflict';
        this.logger.warn(`Reserve failed for ${orden.codigo} at ${comp.productCode}: ${reserveR.error.code}; released ${reservados.length} component(s)`);
        return err(applicationError(
          sinStock ? 'manufacturing.insufficient_stock' : 'manufacturing.reserve_failed',
          sinStock
            ? `No hay stock suficiente de ${comp.productName} (${comp.productCode}): se necesitan ${comp.cantidadTotalRequerida} ${comp.unidadMedida}. No se reservó ningún material.`
            : `No se pudo reservar ${comp.productName} (${comp.productCode}): ${reserveR.error.message}. No se reservó ningún material.`,
          sinStock ? 'conflict' : (reserveR.error.category ?? 'validation'),
          { productCode: comp.productCode, cantidad: comp.cantidadTotalRequerida, unidad: comp.unidadMedida, causa: reserveR.error.code },
        ));
      }

      reservados.push(comp.productId);
      detalle.push({
        productCode: comp.productCode,
        cantidadReservada: reserveR.value.totalAsignado,
        reservaIds: reserveR.value.reservaIds,
      });
    }

    const markR = orden.markMaterialsReserved({ now });
    if (markR.isErr) {
      for (const productId of reservados) {
        await liberar(productId, `Production order ${orden.codigo}: no se pudo marcar como reservada`);
      }
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

export interface CompleteProductionOrderInput {
  ordenId: string;
  /**
   * Lo que se gastó de verdad de cada materia prima (mermas, sobrantes).
   * Componente omitido = consumo teórico: receta × cantidad realmente producida.
   * 0 = no se usó (se devuelve toda la reserva).
   */
  consumos?: Array<{ productId: string; cantidad: number }>;
}

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

@Injectable()
export class CompleteProductionOrderUseCase
  implements UseCase<CompleteProductionOrderInput, OrdenProduccionView>
{
  private readonly logger = new Logger(CompleteProductionOrderUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    private readonly dispatchInventory: DispatchInventoryUseCase,
    private readonly reserveStock: ReserveStockUseCase,
    private readonly releaseReservation: ReleaseReservationUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  /**
   * Completa la orden y descuenta del inventario lo que de verdad se consumió.
   *
   * Por cada materia prima: consumo = el que manda el operario, o si no lo manda,
   * receta × cantidad REALMENTE producida (antes se descontaba siempre lo
   * reservado para la cantidad objetivo, aunque se produjera más o menos).
   *   - Igual a lo reservado → se despacha la reserva tal cual.
   *   - Distinto → se libera la reserva y se reserva/despacha exactamente el
   *     consumo (FEFO). Si es más y no alcanza el stock, se vuelve a apartar lo
   *     que estaba reservado y la orden no se completa.
   *   - 0 → solo se libera la reserva.
   * Cada lote que sale queda como consumo de la orden (trazabilidad lote MP →
   * orden → lote PT). Se guarda la orden tras cada consumo: un reintento salta
   * las materias primas que ya tienen consumos registrados.
   */
  async execute(input: CompleteProductionOrderInput): Promise<Result<OrdenProduccionView, ApplicationError>> {
    const now = this.clock.now();

    const orden = await this.repo.findById(OrdenProduccionId.fromString(input.ordenId));
    if (!orden) {
      return err(applicationError('manufacturing.order_not_found',
        `Production order ${input.ordenId} not found`, 'not_found'));
    }
    if (orden.estado !== EstadoOrdenProduccion.EnProceso) {
      return err(applicationError('manufacturing.must_be_en_proceso',
        `Solo se completa una orden En proceso (estado actual: ${orden.estado}).`, 'validation'));
    }
    if (orden.lotesProducidos.length === 0) {
      return err(applicationError('orden.no_lots_produced',
        'Registra al menos un lote producido antes de completar la orden.', 'validation'));
    }

    // Validar los consumos enviados
    const pedidos = new Map<string, number>();
    for (const c of input.consumos ?? []) {
      if (!orden.componentes.some((k) => k.productId === c.productId)) {
        return err(applicationError('manufacturing.consumption_not_in_bom',
          'Uno de los consumos no es una materia prima de esta orden.', 'validation', { productId: c.productId }));
      }
      if (pedidos.has(c.productId)) {
        return err(applicationError('manufacturing.consumption_duplicated',
          'Una materia prima aparece dos veces en los consumos.', 'validation', { productId: c.productId }));
      }
      if (!Number.isFinite(c.cantidad) || c.cantidad < 0) {
        return err(applicationError('manufacturing.consumption_invalid',
          'El consumo de cada materia prima debe ser 0 o más.', 'validation', { productId: c.productId }));
      }
      pedidos.set(c.productId, round6(c.cantidad));
    }

    const producido = orden.cantidadRealProducida;
    for (const comp of orden.componentes) {
      // Reintento: esta materia prima ya se descontó
      if (orden.consumos.some((c) => c.productId === comp.productId)) continue;

      const ref = `${orden.id.value}:${comp.productId}`;
      const consumo = pedidos.get(comp.productId) ?? round6(comp.cantidadPorUnidad * producido);
      const reservado = comp.cantidadTotalRequerida;

      let despachar = true;
      if (consumo !== reservado) {
        await this.releaseReservation.execute({
          productId: comp.productId, referenciaTipo: TipoReferencia.ProductionOrder, referenciaId: ref,
          reason: `Production order ${orden.codigo}: consumo real ${consumo} ${comp.unidadMedida} (reservado ${reservado})`,
        });
        if (consumo === 0) {
          despachar = false;
        } else {
          const resR = await this.reserveStock.execute({
            productId: comp.productId, cantidad: consumo,
            referenciaTipo: TipoReferencia.ProductionOrder, referenciaId: ref,
          });
          if (resR.isErr) {
            // Devolver la reserva original para no dejar la orden sin materiales
            const back = await this.reserveStock.execute({
              productId: comp.productId, cantidad: reservado,
              referenciaTipo: TipoReferencia.ProductionOrder, referenciaId: ref,
            });
            if (back.isErr) this.logger.error(`Could not restore reservation of ${comp.productCode} for ${orden.codigo}: ${back.error.code}`);
            const sinStock = resR.error.category === 'conflict';
            return err(applicationError(
              sinStock ? 'manufacturing.insufficient_stock' : 'manufacturing.consumption_failed',
              sinStock
                ? `No hay stock para descontar ${consumo} ${comp.unidadMedida} de ${comp.productName}: solo había ${reservado} ${comp.unidadMedida} reservados y no alcanza lo disponible. La orden no se completó.`
                : `No se pudo descontar ${comp.productName}: ${resR.error.message}. La orden no se completó.`,
              sinStock ? 'conflict' : (resR.error.category ?? 'validation'),
              { productCode: comp.productCode, consumo, reservado, unidad: comp.unidadMedida },
            ));
          }
        }
      }
      if (!despachar) continue;

      const dispR = await this.dispatchInventory.execute({
        productId: comp.productId,
        referenciaTipo: TipoReferencia.ProductionOrder,
        referenciaId: ref,
      });
      if (dispR.isErr) {
        if (dispR.error.code === 'inventory.no_reservations_to_dispatch') continue;
        return err(applicationError('manufacturing.consumption_failed',
          `No se pudo descontar ${comp.productName} (${comp.productCode}) del inventario: ${dispR.error.message}`,
          dispR.error.category ?? 'validation'));
      }
      for (const d of dispR.value.detalle) {
        const r = orden.recordConsumption({
          productId: comp.productId,
          productCode: comp.productCode,
          loteId: d.loteId,
          codigoLote: d.codigoLote,
          cantidad: d.cantidad,
          unidadMedida: comp.unidadMedida,
          movimientoId: d.movimientoId,
          now,
        });
        if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'validation'));
        // Un guardado por consumo: el repositorio exige version - 1 (un cambio por guardado).
        await this.repo.save(orden);
      }
    }

    const complR = orden.complete({ now });
    if (complR.isErr) {
      return err(applicationError(complR.error.code, complR.error.message, 'validation'));
    }

    await this.repo.save(orden);
    this.logger.log(`Production order ${orden.codigo} completed; ${orden.consumos.length} consumption record(s)`);
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
    // En Planificada (con materiales) y En proceso las reservas siguen activas: el
    // consumo solo ocurre al completar. Se liberan para devolver el stock.
    if (orden.materialesReservados &&
        (orden.estado === EstadoOrdenProduccion.Planificada || orden.estado === EstadoOrdenProduccion.EnProceso)) {
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