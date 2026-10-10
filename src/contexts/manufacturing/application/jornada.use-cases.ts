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
  EstadoOrdenProduccion,
  ORDEN_PRODUCCION_REPOSITORY,
  OrdenDeProduccion,
  OrdenProduccionRepository,
  PrioridadProduccion,
} from '@eliza/contexts/manufacturing/domain';
import {
  OrdenProduccionView,
  toOrdenProduccionView,
} from '@eliza/contexts/manufacturing/application/dto/manufacturing.views';
import {
  CancelProductionOrderUseCase,
  CreateProductionOrderUseCase,
  ReserveMaterialsUseCase,
  StartProductionUseCase,
} from '@eliza/contexts/manufacturing/application/orden-produccion.use-cases';
import { PRODUCT_REPOSITORY, ProductRepository, ProductStatus } from '@eliza/contexts/catalog/domain';
import { ReleaseReservationUseCase } from '@eliza/contexts/inventory/application';
import { TipoReferencia } from '@eliza/contexts/inventory/domain';

// =====================================================================
// Jornada de producción
// =====================================================================
/**
 * Una jornada agrupa varias órdenes de producción del mismo día de planta, una
 * por producto terminado (ej.: 500 arepas de queso + 300 de chócolo). Cada
 * orden sigue siendo la unidad de reserva, lotes y consumo; la jornada solo las
 * agrupa por un código (JP-AAMMDD-HHMM-XXX) y permite reservar, iniciar y
 * cancelar todas juntas. Completar va por producto, porque cada uno tiene sus
 * propias materias primas y su consumo real.
 */
export type EstadoJornada = 'Planificada' | 'EnProceso' | 'Completada' | 'Cancelada';

export interface JornadaView {
  codigo: string;
  estado: EstadoJornada;
  fechaProgramada: string | null;
  notas: string | null;
  /** Todas las órdenes activas tienen materiales reservados */
  materialesReservados: boolean;
  ordenes: OrdenProduccionView[];
  createdAt: string;
}

export interface JornadaListItemView {
  codigo: string;
  estado: EstadoJornada;
  fechaProgramada: string | null;
  productos: Array<{ ordenId: string; name: string; cantidadObjetivo: number; cantidadRealProducida: number; estado: EstadoOrdenProduccion }>;
  createdAt: string;
}

const ACTIVAS = [EstadoOrdenProduccion.Planificada, EstadoOrdenProduccion.EnProceso];

/** Estado de la jornada a partir de sus órdenes (las canceladas no cuentan si hay otras). */
export function estadoJornada(ordenes: ReadonlyArray<{ estado: EstadoOrdenProduccion }>): EstadoJornada {
  const vivas = ordenes.filter((o) => o.estado !== EstadoOrdenProduccion.Cancelada);
  if (vivas.length === 0) return 'Cancelada';
  if (vivas.every((o) => o.estado === EstadoOrdenProduccion.Completada || o.estado === EstadoOrdenProduccion.Cerrada)) return 'Completada';
  if (vivas.some((o) => o.estado !== EstadoOrdenProduccion.Planificada)) return 'EnProceso';
  return 'Planificada';
}

function toJornadaView(codigo: string, ordenes: OrdenDeProduccion[]): JornadaView {
  const orden = [...ordenes].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const activas = orden.filter((o) => ACTIVAS.includes(o.estado));
  return {
    codigo,
    estado: estadoJornada(orden),
    fechaProgramada: orden[0]?.fechaProgramada?.toISOString() ?? null,
    notas: orden[0]?.notas ?? null,
    materialesReservados: activas.length > 0 && activas.every((o) => o.materialesReservados),
    ordenes: orden.map(toOrdenProduccionView),
    createdAt: (orden[0]?.createdAt ?? new Date(0)).toISOString(),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** JP-AAMMDD-HHMM-XXX (hora del servidor en UTC; solo identifica). */
export function nuevoCodigoJornada(now: Date, rnd: () => number = Math.random): string {
  const s = `${String(now.getUTCFullYear()).slice(2)}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}-${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}`;
  const sufijo = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rnd() * 32)]).join('');
  return `JP-${s}-${sufijo}`;
}

// =====================================================================
// CreateJornada
// =====================================================================
export interface CreateJornadaInput {
  lineas: Array<{ productoTerminadoId: string; cantidadObjetivo: number }>;
  prioridad?: PrioridadProduccion;
  fechaProgramada?: Date;
  notas?: string;
}

@Injectable()
export class CreateJornadaUseCase implements UseCase<CreateJornadaInput, JornadaView> {
  private readonly logger = new Logger(CreateJornadaUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: ProductRepository,
    private readonly createOrder: CreateProductionOrderUseCase,
    private readonly cancelOrder: CancelProductionOrderUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateJornadaInput): Promise<Result<JornadaView, ApplicationError>> {
    if (!this.ctx.tryGetTenantId()) throw new Error('Tenant context required');
    const now = this.clock.now();

    if (input.lineas.length === 0 || input.lineas.length > 20) {
      return err(applicationError('manufacturing.jornada_lineas_invalid', 'Una jornada lleva entre 1 y 20 productos.', 'validation'));
    }
    const ids = input.lineas.map((l) => l.productoTerminadoId);
    if (new Set(ids).size !== ids.length) {
      return err(applicationError('manufacturing.jornada_producto_repetido',
        'Un producto aparece dos veces: suma las cantidades en una sola línea.', 'validation'));
    }

    // Validar TODO antes de crear nada: productos activos, terminados o semielaborados, con receta
    const productos = await this.productRepo.findByIds(ids);
    for (const id of ids) {
      const p = productos.find((x) => x.id.value === id);
      if (!p) return err(applicationError('manufacturing.product_not_found', 'Uno de los productos no existe.', 'not_found', { productId: id }));
      if (p.status !== ProductStatus.Active) {
        return err(applicationError('manufacturing.product_not_active', `${p.name} no está activo.`, 'validation', { productCode: p.code }));
      }
      if (p.components.length === 0) {
        return err(applicationError('manufacturing.no_bom', `${p.name} no tiene receta: defínela en Catálogo antes de producirlo.`, 'validation', { productCode: p.code }));
      }
    }

    // Código único (reintenta si el sufijo aleatorio ya existe)
    let codigo = nuevoCodigoJornada(now);
    for (let i = 0; i < 5 && (await this.repo.countBy({ jornada: codigo, limit: 1, offset: 0 })) > 0; i++) {
      codigo = nuevoCodigoJornada(now);
    }
    const base = codigo.slice(3); // AAMMDD-HHMM-XXX

    const creadas: OrdenDeProduccion[] = [];
    for (const [i, linea] of input.lineas.entries()) {
      const r = await this.createOrder.execute({
        codigo: `OP-${base}-${p2(i + 1)}`,
        productoTerminadoId: linea.productoTerminadoId,
        cantidadObjetivo: linea.cantidadObjetivo,
        prioridad: input.prioridad,
        fechaProgramada: input.fechaProgramada,
        notas: input.notas,
        jornada: codigo,
      });
      if (r.isErr) {
        // No debería pasar tras validar; se cancelan las ya creadas para no dejar una jornada a medias
        for (const o of creadas) {
          await this.cancelOrder.execute({ ordenId: o.id.value, motivo: `Jornada ${codigo} no se pudo crear completa` });
        }
        return err(r.error);
      }
      const o = await this.repo.findByCodigo(r.value.codigo);
      if (o) creadas.push(o);
    }

    this.logger.log(`Jornada ${codigo} created with ${creadas.length} order(s)`);
    return ok(toJornadaView(codigo, creadas));
  }
}

// =====================================================================
// Queries
// =====================================================================
@Injectable()
export class GetJornadaUseCase implements UseCase<{ codigo: string }, JornadaView> {
  constructor(@Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository) {}

  async execute(input: { codigo: string }): Promise<Result<JornadaView, ApplicationError>> {
    const ordenes = await this.repo.list({ jornada: input.codigo, limit: 50, offset: 0 });
    if (ordenes.length === 0) return err(applicationError('manufacturing.jornada_not_found', 'La jornada no existe.', 'not_found'));
    return ok(toJornadaView(input.codigo, ordenes));
  }
}

@Injectable()
export class ListJornadasUseCase implements UseCase<{ limit?: number }, { items: JornadaListItemView[] }> {
  constructor(@Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository) {}

  /** Las jornadas más recientes primero (agrupa las últimas órdenes con jornada). */
  async execute(input: { limit?: number }): Promise<Result<{ items: JornadaListItemView[] }, ApplicationError>> {
    const limit = Math.min(input.limit ?? 30, 100);
    const ordenes = await this.repo.list({ soloJornadas: true, limit: 400, offset: 0 });
    const grupos = new Map<string, OrdenDeProduccion[]>();
    for (const o of ordenes) {
      const g = grupos.get(o.jornada!) ?? [];
      g.push(o);
      grupos.set(o.jornada!, g);
    }
    const items = Array.from(grupos.entries()).slice(0, limit).map(([codigo, os]) => {
      const orden = [...os].sort((a, b) => a.codigo.localeCompare(b.codigo));
      return {
        codigo,
        estado: estadoJornada(orden),
        fechaProgramada: orden[0]?.fechaProgramada?.toISOString() ?? null,
        productos: orden.map((o) => ({
          ordenId: o.id.value, name: o.productoTerminadoName, cantidadObjetivo: o.cantidadObjetivo,
          cantidadRealProducida: o.cantidadRealProducida, estado: o.estado,
        })),
        createdAt: orden[0]!.createdAt.toISOString(),
      };
    });
    return ok({ items });
  }
}

// =====================================================================
// ReserveJornada — todo o nada entre productos
// =====================================================================
@Injectable()
export class ReserveJornadaUseCase implements UseCase<{ codigo: string }, JornadaView> {
  private readonly logger = new Logger(ReserveJornadaUseCase.name);

  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    private readonly reserveMaterials: ReserveMaterialsUseCase,
    private readonly releaseReservation: ReleaseReservationUseCase,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  /**
   * Reserva las materias primas de todos los productos o de ninguno. Las
   * órdenes se reservan una tras otra (si dos productos usan la misma harina,
   * la segunda ve lo que dejó la primera). Si una falla, se devuelven las
   * reservas hechas en esta llamada y esas órdenes quedan sin materiales.
   */
  async execute(input: { codigo: string }): Promise<Result<JornadaView, ApplicationError>> {
    const ordenes = await this.repo.list({ jornada: input.codigo, limit: 50, offset: 0 });
    if (ordenes.length === 0) return err(applicationError('manufacturing.jornada_not_found', 'La jornada no existe.', 'not_found'));

    const pendientes = ordenes
      .filter((o) => o.estado === EstadoOrdenProduccion.Planificada && !o.materialesReservados)
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    if (pendientes.length === 0) {
      return err(applicationError('manufacturing.jornada_nada_que_reservar',
        'No hay productos planificados sin reservar en esta jornada.', 'validation'));
    }

    const hechas: OrdenDeProduccion[] = [];
    for (const o of pendientes) {
      const r = await this.reserveMaterials.execute({ ordenId: o.id.value });
      if (r.isErr) {
        await this.deshacer(hechas, input.codigo);
        this.logger.warn(`Jornada ${input.codigo}: reserve failed at ${o.codigo} (${r.error.code}); undid ${hechas.length}`);
        return err(applicationError(r.error.code,
          `${o.productoTerminadoName}: ${r.error.message}${hechas.length ? ' Se devolvieron también las reservas de los otros productos.' : ''}`,
          r.error.category, r.error.details));
      }
      hechas.push(o);
    }

    const despues = await this.repo.list({ jornada: input.codigo, limit: 50, offset: 0 });
    return ok(toJornadaView(input.codigo, despues));
  }

  private async deshacer(hechas: OrdenDeProduccion[], codigo: string): Promise<void> {
    const now = this.clock.now();
    for (const o of hechas) {
      for (const comp of o.componentes) {
        await this.releaseReservation.execute({
          productId: comp.productId, referenciaTipo: TipoReferencia.ProductionOrder,
          referenciaId: `${o.id.value}:${comp.productId}`,
          reason: `Jornada ${codigo}: reserva incompleta, se deshace`,
        });
      }
      // Recargar: ReserveMaterials guardó la orden con otra versión
      const actual = await this.repo.findById(o.id);
      if (actual && actual.releaseMaterials({ now }).isOk && !actual.materialesReservados) {
        await this.repo.save(actual);
      }
    }
  }
}

// =====================================================================
// StartJornada / CancelJornada
// =====================================================================
@Injectable()
export class StartJornadaUseCase implements UseCase<{ codigo: string }, JornadaView> {
  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    private readonly startOrder: StartProductionUseCase,
  ) {}

  /** Inicia todos los productos planificados con materiales reservados. */
  async execute(input: { codigo: string }): Promise<Result<JornadaView, ApplicationError>> {
    const ordenes = await this.repo.list({ jornada: input.codigo, limit: 50, offset: 0 });
    if (ordenes.length === 0) return err(applicationError('manufacturing.jornada_not_found', 'La jornada no existe.', 'not_found'));
    const planificadas = ordenes.filter((o) => o.estado === EstadoOrdenProduccion.Planificada);
    if (planificadas.length === 0) {
      return err(applicationError('manufacturing.jornada_nada_que_iniciar', 'No hay productos planificados en esta jornada.', 'validation'));
    }
    const sinReserva = planificadas.filter((o) => !o.materialesReservados);
    if (sinReserva.length > 0) {
      return err(applicationError('manufacturing.materials_not_reserved',
        `Primero reserva los materiales de: ${sinReserva.map((o) => o.productoTerminadoName).join(', ')}.`, 'validation'));
    }
    for (const o of planificadas) {
      const r = await this.startOrder.execute({ ordenId: o.id.value });
      if (r.isErr) return err(r.error);
    }
    const despues = await this.repo.list({ jornada: input.codigo, limit: 50, offset: 0 });
    return ok(toJornadaView(input.codigo, despues));
  }
}

@Injectable()
export class CancelJornadaUseCase implements UseCase<{ codigo: string; motivo: string }, JornadaView> {
  constructor(
    @Inject(ORDEN_PRODUCCION_REPOSITORY) private readonly repo: OrdenProduccionRepository,
    private readonly cancelOrder: CancelProductionOrderUseCase,
  ) {}

  /** Cancela los productos planificados o en proceso (devuelve sus reservas). Los completados se quedan. */
  async execute(input: { codigo: string; motivo: string }): Promise<Result<JornadaView, ApplicationError>> {
    if (!input.motivo || input.motivo.trim().length < 3) {
      return err(applicationError('orden.motivo_required', 'Escribe el motivo de la cancelación.', 'validation'));
    }
    const ordenes = await this.repo.list({ jornada: input.codigo, limit: 50, offset: 0 });
    if (ordenes.length === 0) return err(applicationError('manufacturing.jornada_not_found', 'La jornada no existe.', 'not_found'));
    const activas = ordenes.filter((o) => ACTIVAS.includes(o.estado));
    if (activas.length === 0) {
      return err(applicationError('manufacturing.jornada_nada_que_cancelar', 'No hay productos activos en esta jornada.', 'validation'));
    }
    for (const o of activas) {
      const r = await this.cancelOrder.execute({ ordenId: o.id.value, motivo: input.motivo.trim() });
      if (r.isErr) return err(r.error);
    }
    const despues = await this.repo.list({ jornada: input.codigo, limit: 50, offset: 0 });
    return ok(toJornadaView(input.codigo, despues));
  }
}
