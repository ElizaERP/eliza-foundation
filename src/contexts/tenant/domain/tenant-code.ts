import { DomainError, Guard, Result, ValueObject, err, ok } from '@eliza/shared-kernel/domain';

interface TenantCodeProps {
  value: string;
}

/**
 * TenantCode — identificador legible y único del tenant a nivel
 * plataforma. Usado en subdomains, URLs y para que humanos referencien
 * tenants sin lidiar con UUIDs.
 *
 * Invariantes:
 *   - 3 a 50 caracteres
 *   - Solo minúsculas, dígitos y guiones
 *   - Debe empezar con letra
 *   - No puede tener guiones consecutivos
 *   - No puede empezar ni terminar con guión
 *
 * Ejemplos válidos: 'acme', 'congelados-bcm', 'tenant-001'
 * Ejemplos inválidos: 'ACME', '-acme', '1acme', 'a--b'
 */
export class TenantCode extends ValueObject<TenantCodeProps> {
  static readonly MIN_LENGTH = 3;
  static readonly MAX_LENGTH = 50;
  private static readonly PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

  private constructor(props: TenantCodeProps) {
    super(props);
  }

  get value(): string {
    return this.props.value;
  }

  static create(raw: string): Result<TenantCode, DomainError> {
    const normalized = raw?.toLowerCase().trim();

    const validated = Guard.combine(
      Guard.againstNullOrUndefined(normalized, 'tenantCode'),
      Guard.againstEmptyString(normalized, 'tenantCode'),
      Guard.againstLengthOutOfBounds(normalized, 'tenantCode', this.MIN_LENGTH, this.MAX_LENGTH),
      Guard.againstInvalidPattern(
        normalized,
        'tenantCode',
        this.PATTERN,
        'lowercase alphanumeric with single hyphens, must start with a letter',
      ),
    );

    if (validated.isErr) return err(validated.error);

    return ok(new TenantCode({ value: normalized }));
  }
}
