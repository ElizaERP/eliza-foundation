import { ulid } from 'ulid';
import { v4 as uuidv4, v7 as uuidv7, validate as uuidValidate } from 'uuid';

/**
 * UUID v7 (RFC 9562): valido y ordenable por tiempo (los primeros 48 bits son
 * el timestamp, igual que un ULID). Reemplaza las conversiones ULID->UUID hechas
 * a mano en cada contexto, que producian UUID con version/variante invalidas y
 * hacian fallar la creacion de agregados (Fase 13).
 */
export function newTimeOrderedUuid(): string {
  return uuidv7();
}

/**
 * Base abstracta para identificadores tipados.
 *
 * Por qué un Identifier genérico en vez de `string`:
 *   - Tipado nominal: TenantId no es asignable a UserId aunque ambos sean
 *     UUIDs, lo que previene bugs de "pasé el ID equivocado".
 *   - Validación centralizada del formato (UUID/ULID).
 *   - Generación consistente (UUID v7 vía ULID para ordenamiento temporal).
 *
 * Cada agregado define su propio Identifier extendiendo esta clase:
 *
 *   export class TenantId extends Identifier<'Tenant'> {}
 *
 * El parámetro de tipo `Brand` es phantom — solo existe en compile time.
 */
export abstract class Identifier<Brand extends string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly _brand!: Brand;

  protected constructor(public readonly value: string) {
    if (!Identifier.isValidUuid(value)) {
      throw new Error(`Invalid identifier format: ${value}`);
    }
  }

  /** Genera un nuevo UUID v7 ordenable temporalmente (vía ULID). */
  protected static generateUuid(): string {
    // ULID en formato UUID: 26 chars Crockford base32 → 36 chars UUID
    // Usamos UUID v4 por compatibilidad con Postgres uuid type, pero los
    // agregados pueden migrar a ulid().toUUID() cuando se requiera orden.
    return uuidv4();
  }

  protected static generateUlid(): string {
    return ulid();
  }

  static isValidUuid(value: string): boolean {
    return typeof value === 'string' && uuidValidate(value);
  }

  equals(other?: Identifier<Brand> | null): boolean {
    if (other === null || other === undefined) return false;
    if (!(other instanceof Identifier)) return false;
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
