import { Result } from '@eliza/shared-kernel/domain';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';

/**
 * Convierte un Result devuelto por un UseCase en el value desempaquetado.
 * Si el resultado es Err, lanza el ApplicationError tal cual — el
 * filtro global ProblemDetailsExceptionFilter lo transforma en RFC 7807.
 *
 * Es la única forma en que los controllers manejan errores: nunca
 * inspeccionan `result.isErr` ni convierten a HttpException
 * manualmente. La conversión está centralizada.
 */
export function toAppErrorOrThrow<T>(result: Result<T, ApplicationError>): T {
  if (result.isErr) {
    throw result.error;
  }
  return result.value;
}
