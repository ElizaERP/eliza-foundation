import { DomainError, domainError, Result, err, ok } from './result';

/**
 * Guard clauses para validaciones comunes en factories de dominio.
 *
 * Cada método devuelve un Result; el factory puede componerlos para
 * acumular errores o cortar al primer fallo.
 */
export class Guard {
  static againstNullOrUndefined<T>(value: T, fieldName: string): Result<T, DomainError> {
    if (value === null || value === undefined) {
      return err(domainError('guard.null_or_undefined', `${fieldName} is required`, { fieldName }));
    }
    return ok(value);
  }

  static againstEmptyString(value: string, fieldName: string): Result<string, DomainError> {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length === 0) {
      return err(
        domainError('guard.empty_string', `${fieldName} must not be empty`, { fieldName }),
      );
    }
    return ok(trimmed);
  }

  static againstLengthOutOfBounds(
    value: string,
    fieldName: string,
    min: number,
    max: number,
  ): Result<string, DomainError> {
    if (value.length < min || value.length > max) {
      return err(
        domainError(
          'guard.length_out_of_bounds',
          `${fieldName} must be between ${min} and ${max} characters`,
          { fieldName, length: value.length, min, max },
        ),
      );
    }
    return ok(value);
  }

  static againstInvalidPattern(
    value: string,
    fieldName: string,
    pattern: RegExp,
    description: string,
  ): Result<string, DomainError> {
    if (!pattern.test(value)) {
      return err(
        domainError(
          'guard.invalid_pattern',
          `${fieldName} must match ${description}`,
          { fieldName, value, pattern: pattern.source },
        ),
      );
    }
    return ok(value);
  }

  static againstOutOfRange(
    value: number,
    fieldName: string,
    min: number,
    max: number,
  ): Result<number, DomainError> {
    if (value < min || value > max) {
      return err(
        domainError(
          'guard.out_of_range',
          `${fieldName} must be between ${min} and ${max}`,
          { fieldName, value, min, max },
        ),
      );
    }
    return ok(value);
  }

  /** Combina varios Results; devuelve Ok solo si todos son Ok. */
  static combine(...results: Result<unknown, DomainError>[]): Result<true, DomainError> {
    for (const result of results) {
      if (result.isErr) return err(result.error);
    }
    return ok(true);
  }
}
