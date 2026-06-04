import { Identifier } from '@eliza/shared-kernel/domain';
import { v4 as uuidv4 } from 'uuid';

/**
 * Identificador tipado del agregado Tenant.
 *
 * Aunque es un UUID, no es asignable a UserId u otro Identifier de
 * otro agregado — el compilador lo previene gracias al brand 'Tenant'.
 */
export class TenantId extends Identifier<'Tenant'> {
  private constructor(value: string) {
    super(value);
  }

  static fromString(value: string): TenantId {
    return new TenantId(value);
  }

  static generate(): TenantId {
    return new TenantId(uuidv4());
  }
}
