import { DomainError, Guard, Result, ValueObject, err, ok } from '@eliza/shared-kernel/domain';

interface TenantNameProps {
  value: string;
}

/**
 * TenantName — razón social o nombre comercial del tenant. Visible al
 * usuario final; no se usa en URLs (para eso está TenantCode).
 *
 * Invariantes:
 *   - 1 a 200 caracteres tras trim
 *   - No solo whitespace
 */
export class TenantName extends ValueObject<TenantNameProps> {
  static readonly MIN_LENGTH = 1;
  static readonly MAX_LENGTH = 200;

  private constructor(props: TenantNameProps) {
    super(props);
  }

  get value(): string {
    return this.props.value;
  }

  static create(raw: string): Result<TenantName, DomainError> {
    const trimmed = raw?.trim();

    const validated = Guard.combine(
      Guard.againstNullOrUndefined(trimmed, 'tenantName'),
      Guard.againstEmptyString(trimmed, 'tenantName'),
      Guard.againstLengthOutOfBounds(trimmed, 'tenantName', this.MIN_LENGTH, this.MAX_LENGTH),
    );

    if (validated.isErr) return err(validated.error);

    return ok(new TenantName({ value: trimmed }));
  }
}
