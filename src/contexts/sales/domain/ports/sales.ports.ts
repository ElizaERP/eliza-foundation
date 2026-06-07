import { Cliente } from '../cliente';
import { OrdenDeVenta } from '../orden-venta';
import {
  ClienteId,
  EstadoCliente,
  EstadoOrdenVenta,
  OrdenVentaId,
} from '../value-objects';

// =====================================================================
// Tokens de DI
// =====================================================================
export const CLIENTE_REPOSITORY = Symbol('ClienteRepository');
export const ORDEN_VENTA_REPOSITORY = Symbol('OrdenVentaRepository');

// =====================================================================
// ClienteRepository
// =====================================================================
export interface ClienteRepository {
  findById(id: ClienteId): Promise<Cliente | null>;
  findByCodigo(codigo: string): Promise<Cliente | null>;
  findByNit(nit: string): Promise<Cliente | null>;
  list(filter: ClienteFilter): Promise<Cliente[]>;
  countBy(filter: ClienteFilter): Promise<number>;
  save(cliente: Cliente): Promise<void>;
}

export interface ClienteFilter {
  estado?: EstadoCliente;
  search?: string;
  limit: number;
  offset: number;
}

// =====================================================================
// OrdenVentaRepository
// =====================================================================
export interface OrdenVentaRepository {
  findById(id: OrdenVentaId): Promise<OrdenDeVenta | null>;
  findByCodigo(codigo: string): Promise<OrdenDeVenta | null>;
  findByCliente(clienteId: string, limit: number, offset: number): Promise<OrdenDeVenta[]>;
  list(filter: OrdenVentaFilter): Promise<OrdenDeVenta[]>;
  countBy(filter: OrdenVentaFilter): Promise<number>;
  save(orden: OrdenDeVenta): Promise<void>;
}

export interface OrdenVentaFilter {
  estado?: EstadoOrdenVenta;
  clienteId?: string;
  creadoDesde?: Date;
  creadoHasta?: Date;
  limit: number;
  offset: number;
}