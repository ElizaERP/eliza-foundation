import { Identifier } from './identifier';

/**
 * Entity base (DDD).
 *
 * Características:
 *   - Tiene identidad: se identifica por su ID, no por sus atributos.
 *   - Igualdad por ID: dos entidades son iguales si sus IDs son iguales,
 *     independientemente de que sus otros atributos difieran.
 *   - Mutable: los métodos pueden cambiar el estado (a diferencia de los VOs).
 *   - Pertenece a un Aggregate Root: nunca se persiste de forma independiente.
 *
 * Ejemplos en ELIZA: TenantSettings (dentro del Tenant aggregate),
 * UserTenantMembership (dentro de User aggregate).
 */
export abstract class Entity<Id extends Identifier<string>, Props extends object> {
  protected readonly _id: Id;
  protected props: Props;

  protected constructor(id: Id, props: Props) {
    this._id = id;
    this.props = props;
  }

  get id(): Id {
    return this._id;
  }

  equals(other?: Entity<Id, Props> | null): boolean {
    if (other === null || other === undefined) return false;
    if (this === other) return true;
    if (!(other instanceof Entity)) return false;
    return this._id.equals(other._id);
  }
}
