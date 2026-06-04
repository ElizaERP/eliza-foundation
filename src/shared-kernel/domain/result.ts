/**
 * Result<T, E> — encapsula éxito o error sin lanzar excepciones.
 *
 * Por qué Result en lugar de throw:
 *   - Los errores de dominio son parte de la firma del método. El compilador
 *     obliga al caller a manejarlos.
 *   - No hay overhead de stack trace cuando el "error" es esperable
 *     (ej: "Tenant con ese código ya existe").
 *   - Las excepciones quedan reservadas para fallos reales: bugs,
 *     fallos de infra, violaciones de invariantes irrecuperables.
 *
 * Convención en ELIZA:
 *   - Métodos de dominio que pueden fallar de manera esperada → Result<T, DomainError>
 *   - Validaciones en factories `create()` → Result<T, ValidationError>
 *   - Excepciones (throw) reservadas para condiciones que NUNCA deberían
 *     pasar y que indican un bug (ej: estado interno inconsistente).
 */
export type Result<T, E = DomainError> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
  readonly isOk = true as const;
  readonly isErr = false as const;

  constructor(public readonly value: T) {}

  unwrap(): T {
    return this.value;
  }

  unwrapErr(): never {
    throw new Error('Called unwrapErr on Ok');
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return new Ok<T, F>(this.value);
  }

  andThen<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }
}

export class Err<T, E> {
  readonly isOk = false as const;
  readonly isErr = true as const;

  constructor(public readonly error: E) {}

  unwrap(): never {
    throw new Error(`Called unwrap on Err: ${JSON.stringify(this.error)}`);
  }

  unwrapErr(): E {
    return this.error;
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Err<U, E>(this.error);
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }

  andThen<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
    return new Err<U, E>(this.error);
  }
}

export const ok = <T, E = DomainError>(value: T): Result<T, E> => new Ok(value);
export const err = <T = never, E = DomainError>(error: E): Result<T, E> => new Err(error);

/**
 * Estructura base de errores de dominio. Los BCs definirán códigos
 * específicos (ej: 'tenant.code_already_exists', 'user.email_invalid').
 */
export interface DomainError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export const domainError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DomainError => ({ code, message, details });
