import { Result } from '../domain/result';

/**
 * Use Case base (Application Layer · Hexagonal).
 *
 * Un caso de uso es un servicio de aplicación que orquesta el dominio
 * para satisfacer una intención del usuario. Es el "driving adapter"
 * que entra por los puertos primarios del hexágono.
 *
 * Reglas:
 *   - Una sola responsabilidad por caso de uso (ConfirmOrder, CreateTenant).
 *   - Recibe DTOs de entrada y devuelve DTOs de salida (nunca entidades).
 *   - Devuelve Result<Output, ApplicationError> — no lanza para errores
 *     esperables.
 *   - Coordina: validación, autorización, carga de agregados, invocación
 *     de métodos de dominio, persistencia, publicación de eventos.
 *   - No contiene lógica de negocio: esa vive en el dominio.
 *
 * Se separa Command (escritura) de Query (lectura) por CQRS.
 */
export interface UseCase<Input, Output, Error = ApplicationError> {
  execute(input: Input): Promise<Result<Output, Error>>;
}

/** Marker: representa una intención de cambio de estado. */
export interface Command {
  readonly __type: 'Command';
}

/** Marker: representa una intención de lectura sin efectos secundarios. */
export interface Query {
  readonly __type: 'Query';
}

/**
 * Error base de la capa de aplicación. Más amplio que DomainError porque
 * cubre fallos no-de-dominio: autorización denegada, tenant suspendido,
 * agregado no encontrado, conflicto de concurrencia.
 */
export interface ApplicationError {
  readonly code: string;
  readonly message: string;
  readonly category: ApplicationErrorCategory;
  readonly details?: Record<string, unknown>;
}

export type ApplicationErrorCategory =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'unauthorized'
  | 'forbidden'
  | 'tenant_inactive'
  | 'concurrency'
  | 'infrastructure'
  | 'domain';

export const applicationError = (
  code: string,
  message: string,
  category: ApplicationErrorCategory,
  details?: Record<string, unknown>,
): ApplicationError => ({ code, message, category, details });
