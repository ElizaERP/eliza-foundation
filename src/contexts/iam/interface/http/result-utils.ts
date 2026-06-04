import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';

export function toAppErrorOrThrow<T>(result: Result<T, ApplicationError>): T {
  if (result.isErr) throw result.error;
  return result.value;
}
