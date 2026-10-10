import { AggregateRoot } from '../domain/aggregate-root';
import { DomainEvent } from '../domain/domain-event';
import { Identifier } from '../domain/identifier';
import { Result, err } from '../domain/result';

/**
 * =====================================================================
 * Ports (Hexagonal Architecture)
 * =====================================================================
 * Los ports son interfaces que el dominio/aplicación define y que la
 * infraestructura implementa. Vive aquí porque son CONTRATOS del lado
 * de aplicación; nunca importan tipos de infraestructura.
 *
 * Tipos de ports:
 *   - Driving (primarios): los expone la app para que entren al dominio
 *     (ej: REST controllers que invocan UseCases).
 *   - Driven (secundarios): los necesita la app para hablar con el mundo
 *     exterior (ej: repos, event bus, clock, identity provider).
 *
 * Inyección: Nest DI resuelve los ports a sus adapters concretos vía
 * tokens declarados como Symbols.
 * =====================================================================
 */

// ---------- Repository port ----------
export interface Repository<
  TAggregate extends AggregateRoot<Identifier<string>, object>,
  TId extends Identifier<string>,
> {
  findById(id: TId): Promise<TAggregate | null>;
  save(aggregate: TAggregate): Promise<void>;
}

// ---------- Tenant Context port ----------
/**
 * Acceso al contexto del tenant en curso. Se popula por el middleware
 * a partir del JWT y se propaga por AsyncLocalStorage (nestjs-cls).
 *
 * Nunca aceptar tenant_id desde el body o query string.
 */
export interface TenantContextPort {
  /** Tenant del request actual. Lanza si no está establecido. */
  getTenantId(): string;
  /** Tenant del request actual o null si no hay contexto (ej: tareas de plataforma). */
  tryGetTenantId(): string | null;
  /** Usuario del request actual. Null para operaciones de sistema. */
  tryGetUserId(): string | null;
  /** ID de correlación para trazabilidad cross-context. */
  getCorrelationId(): string;
}

export const TENANT_CONTEXT_PORT = Symbol('TenantContextPort');

// ---------- Clock port ----------
/**
 * Reloj inyectable para testeo. El dominio no llama a `new Date()`
 * directamente — usa este port. Permite testear código con tiempo
 * congelado.
 */
export interface ClockPort {
  now(): Date;
  nowIso(): string;
}

export const CLOCK_PORT = Symbol('ClockPort');

// ---------- Event Publisher port ----------
/**
 * Publicador de eventos de dominio. La implementación por defecto
 * persiste en Outbox dentro de la transacción del agregado y un
 * dispatcher asíncrono los publica al bus interno (in-process CQRS).
 *
 * Al extraer microservicios, el adapter cambia a Kafka/RabbitMQ sin
 * que el dominio se entere.
 */
export interface EventPublisherPort {
  /** Persiste los eventos en la outbox para publicación garantizada. */
  enqueue(events: DomainEvent[]): Promise<void>;
}

export const EVENT_PUBLISHER_PORT = Symbol('EventPublisherPort');

// ---------- Unit of Work port ----------
/**
 * Unit of Work: agrupa varias operaciones del repositorio en una sola
 * transacción de Postgres. Crítico para garantizar atomicidad entre
 * la persistencia del agregado y la outbox.
 */
export interface UnitOfWorkPort {
  execute<T>(work: () => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK_PORT = Symbol('UnitOfWorkPort');

/** Lo lanza `atomically` para revertir la transacción cuando el trabajo devuelve err. */
class RollbackWithResult<E> {
  constructor(readonly error: E) {}
}

/**
 * Ejecuta trabajo que devuelve Result dentro de una unidad de trabajo:
 * si devuelve err, la transacción se REVIERTE (nada de lo escrito queda) y
 * se devuelve ese mismo err. Si lanza, también se revierte y la excepción sigue.
 */
export async function atomically<T, E>(
  uow: UnitOfWorkPort,
  work: () => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  try {
    return await uow.execute(async () => {
      const r = await work();
      if (r.isErr) throw new RollbackWithResult(r.error);
      return r;
    });
  } catch (e) {
    if (e instanceof RollbackWithResult) return err<T, E>(e.error as E);
    throw e;
  }
}

// ---------- Tenant Access port ----------
/**
 * ¿Puede operar hoy este tenant? Lo consulta el JwtAuthGuard en cada
 * request autenticado, después de verificar el token. Lo implementa el
 * Tenant Context (dueño del estado del tenant); IAM solo conoce este
 * contrato, no el agregado Tenant.
 *
 *   - 'active'    → el tenant está Active: el request sigue.
 *   - 'suspended' → Suspended: 403 `tenant.suspended`.
 *   - 'inactive'  → PendingActivation, Deleted o inexistente: 403 `tenant.inactive`.
 */
export type TenantAccess = 'active' | 'suspended' | 'inactive';

export interface TenantAccessPort {
  check(tenantId: string): Promise<TenantAccess>;
}

export const TENANT_ACCESS_PORT = Symbol('TenantAccessPort');
