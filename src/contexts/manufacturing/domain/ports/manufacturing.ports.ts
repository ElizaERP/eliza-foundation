import { OrdenDeProduccion } from '../orden-produccion';
import {
  EstadoOrdenProduccion,
  OrdenProduccionId,
} from '../value-objects';

// =====================================================================
// Token de DI
// =====================================================================
export const ORDEN_PRODUCCION_REPOSITORY = Symbol('OrdenProduccionRepository');

// =====================================================================
// OrdenProduccionRepository
// =====================================================================
export interface OrdenProduccionRepository {
  findById(id: OrdenProduccionId): Promise<OrdenDeProduccion | null>;

  findByCodigo(codigo: string): Promise<OrdenDeProduccion | null>;

  findByProductoTerminado(
    productoTerminadoId: string,
    limit: number,
    offset: number,
  ): Promise<OrdenDeProduccion[]>;

  list(filter: OrdenProduccionFilter): Promise<OrdenDeProduccion[]>;

  countBy(filter: OrdenProduccionFilter): Promise<number>;

  /** Persiste con optimistic concurrency + outbox transaccional. */
  save(orden: OrdenDeProduccion): Promise<void>;
}

// =====================================================================
// Filter para queries de listado
// =====================================================================
export interface OrdenProduccionFilter {
  estado?: EstadoOrdenProduccion;
  productoTerminadoId?: string;
  prioridad?: string;
  fechaProgramadaDesde?: Date;
  fechaProgramadaHasta?: Date;
  /** Órdenes de una jornada (por su código). */
  jornada?: string;
  /** Solo órdenes que pertenecen a alguna jornada. */
  soloJornadas?: boolean;
  limit: number;
  offset: number;
}