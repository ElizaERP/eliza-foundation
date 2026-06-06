import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DomainError,
  Result,
  err,
  ok,
} from '@eliza/shared-kernel/domain';
import {
  Cantidad,
  EXISTENCIA_REPOSITORY,
  Existencia,
  ExistenciaRepository,
  LOTE_REPOSITORY,
  LoteRepository,
  ReferenciaOrigen,
} from '@eliza/contexts/inventory/domain';

export interface FefoAssignment {
  existenciaId: string;
  loteId: string;
  codigoLote: string;
  fechaVencimiento: Date;
  cantidadAsignada: number;
}

export interface FefoReservationResult {
  totalAsignado: number;
  asignaciones: FefoAssignment[];
  reservaIds: string[];
}

/**
 * FefoReservationService — Domain Service.
 *
 * Implementa la política FEFO (First-Expired-First-Out):
 *   1. Lista todas las Existencias del SKU ordenadas por
 *      fechaVencimiento del lote ASC (las que vencen primero, primero).
 *   2. Filtra solo lotes "reservables" (Disponible + no vencidos).
 *   3. Itera asignando cantidad hasta cubrir lo solicitado.
 *   4. Cada Existencia.reserve() emite su propio InventoryReserved.
 *   5. Si no hay stock suficiente → falla con InsufficientStock.
 *
 * IMPORTANTE: este servicio NO persiste. Devuelve las existencias
 * modificadas (con sus eventos pendientes) y el use case que lo
 * invoca es el responsable de:
 *   - Llamarlo dentro de una transacción
 *   - Guardar las existencias modificadas vía el repositorio
 *   - Drenar y persistir los eventos al outbox
 */
@Injectable()
export class FefoReservationService {
  private readonly logger = new Logger(FefoReservationService.name);

  constructor(
    @Inject(EXISTENCIA_REPOSITORY) private readonly existenciaRepo: ExistenciaRepository,
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
  ) {}

  /**
   * Asigna stock siguiendo FEFO.
   *
   * @returns Las existencias modificadas con sus eventos drenables, y
   *          la lista de asignaciones realizadas (para auditoría).
   */
  async assign(args: {
    productId: string;
    cantidadTotal: Cantidad;
    referencia: ReferenciaOrigen;
    locationId?: string;
    now: Date;
  }): Promise<Result<{ existenciasModificadas: Existencia[]; resultado: FefoReservationResult }, DomainError>> {
    const candidatas = await this.existenciaRepo.findBySkuOrderedByExpiry(args.productId, true);
    if (candidatas.length === 0) {
      return err({ code: 'fefo.no_stock_available',
        message: `No reservable stock found for product ${args.productId}`,
        details: { productId: args.productId, requested: args.cantidadTotal.amount } });
    }

    // Filtrar por ubicación si se especificó
    const elegibles = args.locationId
      ? candidatas.filter((e) => e.locationId.value === args.locationId)
      : candidatas;

    if (elegibles.length === 0) {
      return err({ code: 'fefo.no_stock_in_location',
        message: `No stock found in location ${args.locationId} for product ${args.productId}` });
    }

    // Verificar disponibilidad total ANTES de modificar nada
    const disponibleTotal = elegibles.reduce(
      (sum, e) => sum + e.cantidadDisponible.amount, 0);
    if (disponibleTotal < args.cantidadTotal.amount) {
      return err({ code: 'fefo.insufficient_stock',
        message: `Insufficient stock: requested ${args.cantidadTotal.amount}, available ${disponibleTotal}`,
        details: {
          productId: args.productId,
          requested: args.cantidadTotal.amount,
          available: disponibleTotal,
          existenciasConsideradas: elegibles.length,
        } });
    }

    // Asignar cantidad iterando por fechaVencimiento ASC
    let pendiente = args.cantidadTotal.amount;
    const asignaciones: FefoAssignment[] = [];
    const modificadas: Existencia[] = [];
    const reservaIds: string[] = [];

    for (const existencia of elegibles) {
      if (pendiente <= 0) break;

      // Necesitamos el lote para mostrar fecha de vencimiento en el resultado
      const lote = await this.loteRepo.findById(existencia.loteId);
      if (!lote) {
        this.logger.warn(`Lote ${existencia.loteId.value} referenced by Existencia ${existencia.id.value} not found`);
        continue;
      }

      const disponibleAqui = existencia.cantidadDisponible.amount;
      if (disponibleAqui <= 0) continue;

      const aAsignar = Math.min(pendiente, disponibleAqui);
      const cantR = Cantidad.createPositive(aAsignar);
      if (cantR.isErr) {
        this.logger.error(`Failed to create Cantidad for ${aAsignar}: ${cantR.error.message}`);
        continue;
      }

      const reserveR = existencia.reserve({
        cantidad: cantR.value,
        referencia: args.referencia,
        now: args.now,
      });

      if (reserveR.isErr) {
        // Si una falla, abortamos toda la operación (la transacción del use case
        // hará rollback de cualquier cambio anterior)
        return err({ code: 'fefo.reservation_failed',
          message: `Failed to reserve on existencia ${existencia.id.value}: ${reserveR.error.message}`,
          details: reserveR.error.details });
      }

      const reserva = reserveR.value;
      asignaciones.push({
        existenciaId: existencia.id.value,
        loteId: lote.id.value,
        codigoLote: lote.codigoLote,
        fechaVencimiento: lote.fechaVencimiento.date,
        cantidadAsignada: aAsignar,
      });
      reservaIds.push(reserva.id.value);
      modificadas.push(existencia);
      pendiente -= aAsignar;
    }

    if (pendiente > 0) {
      // No debería ocurrir tras la verificación inicial, pero por defensa
      return err({ code: 'fefo.could_not_fulfill',
        message: `Could not fulfill ${args.cantidadTotal.amount} units; ${pendiente} remaining` });
    }

    return ok({
      existenciasModificadas: modificadas,
      resultado: {
        totalAsignado: args.cantidadTotal.amount,
        asignaciones,
        reservaIds,
      },
    });
  }
}
