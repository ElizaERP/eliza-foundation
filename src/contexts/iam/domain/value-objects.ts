import { DomainError, Guard, Identifier, Result, ValueObject, err, ok } from '@eliza/shared-kernel/domain';
import { v4 as uuidv4 } from 'uuid';

/**
 * UserId — identidad tipada del usuario en ELIZA. Independiente del
 * keycloak subject (este último es el ID que asigna Keycloak).
 */
export class UserId extends Identifier<'User'> {
  private constructor(value: string) {
    super(value);
  }
  static fromString(value: string): UserId {
    return new UserId(value);
  }
  static generate(): UserId {
    return new UserId(uuidv4());
  }
}

/**
 * KeycloakSubject — el `sub` claim del JWT que Keycloak emite. Es el
 * vínculo entre la identidad federada y nuestro modelo local de usuario.
 *
 * En realidad es un UUID que Keycloak genera al crear el usuario, pero
 * lo tratamos como un VO opaco para no acoplarnos a su formato.
 */
interface KeycloakSubjectProps {
  value: string;
}
export class KeycloakSubject extends ValueObject<KeycloakSubjectProps> {
  private constructor(props: KeycloakSubjectProps) {
    super(props);
  }
  get value(): string {
    return this.props.value;
  }
  static create(raw: string): Result<KeycloakSubject, DomainError> {
    const trimmed = raw?.trim();
    const v = Guard.combine(
      Guard.againstNullOrUndefined(trimmed, 'keycloakSubject'),
      Guard.againstEmptyString(trimmed, 'keycloakSubject'),
      Guard.againstLengthOutOfBounds(trimmed, 'keycloakSubject', 1, 100),
    );
    if (v.isErr) return err(v.error);
    return ok(new KeycloakSubject({ value: trimmed }));
  }
}

/**
 * EmailAddress — validación de formato + normalización (lowercase).
 * Invariantes:
 *   - Cumple con un patrón razonable de email (no RFC 5322 completo,
 *     pero cubre 99% de casos reales sin permitir basura obvia)
 *   - Longitud total ≤ 320 (RFC 5321)
 */
interface EmailAddressProps {
  value: string;
}
export class EmailAddress extends ValueObject<EmailAddressProps> {
  static readonly MAX_LENGTH = 320;
  private static readonly PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

  private constructor(props: EmailAddressProps) {
    super(props);
  }
  get value(): string {
    return this.props.value;
  }
  get domain(): string {
    return this.props.value.split('@')[1];
  }
  static create(raw: string): Result<EmailAddress, DomainError> {
    const normalized = raw?.toLowerCase().trim();
    const v = Guard.combine(
      Guard.againstNullOrUndefined(normalized, 'email'),
      Guard.againstEmptyString(normalized, 'email'),
      Guard.againstLengthOutOfBounds(normalized, 'email', 3, this.MAX_LENGTH),
      Guard.againstInvalidPattern(normalized, 'email', this.PATTERN, 'a valid email address'),
    );
    if (v.isErr) return err(v.error);
    return ok(new EmailAddress({ value: normalized }));
  }
}

/**
 * FullName — nombre completo del usuario, 1..200 caracteres.
 */
interface FullNameProps {
  value: string;
}
export class FullName extends ValueObject<FullNameProps> {
  static readonly MAX_LENGTH = 200;
  private constructor(props: FullNameProps) {
    super(props);
  }
  get value(): string {
    return this.props.value;
  }
  static create(raw: string): Result<FullName, DomainError> {
    const trimmed = raw?.trim();
    const v = Guard.combine(
      Guard.againstNullOrUndefined(trimmed, 'fullName'),
      Guard.againstEmptyString(trimmed, 'fullName'),
      Guard.againstLengthOutOfBounds(trimmed, 'fullName', 1, this.MAX_LENGTH),
    );
    if (v.isErr) return err(v.error);
    return ok(new FullName({ value: trimmed }));
  }
}
