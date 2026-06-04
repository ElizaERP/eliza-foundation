/**
 * Value Object base (DDD).
 *
 * Características:
 *   - Inmutable: las props se congelan en el constructor.
 *   - Igualdad estructural: dos VOs son iguales si sus props son iguales.
 *   - Sin identidad: distinto de una Entity, que se identifica por su ID.
 *
 * Ejemplos en ELIZA: TenantCode, EmailAddress, Money, Quantity, DateRange.
 *
 * Convención: los VOs validan sus invariantes en un factory `create()`
 * que devuelve Result<T, DomainError>, no en el constructor. El
 * constructor queda protegido para forzar el uso del factory.
 */
export abstract class ValueObject<Props extends object> {
  protected readonly props: Readonly<Props>;

  protected constructor(props: Props) {
    this.props = Object.freeze({ ...props });
  }

  equals(other?: ValueObject<Props> | null): boolean {
    if (other === null || other === undefined) return false;
    if (other.props === undefined) return false;
    if (this.constructor !== other.constructor) return false;
    return ValueObject.shallowEqual(this.props, other.props);
  }

  private static shallowEqual(a: object, b: object): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      const valueA = (a as Record<string, unknown>)[key];
      const valueB = (b as Record<string, unknown>)[key];
      if (valueA instanceof ValueObject && valueB instanceof ValueObject) {
        if (!valueA.equals(valueB)) return false;
      } else if (valueA !== valueB) {
        return false;
      }
    }
    return true;
  }

  toJSON(): Props {
    return { ...this.props };
  }
}
