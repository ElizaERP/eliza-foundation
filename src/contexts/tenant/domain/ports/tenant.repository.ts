import { Tenant } from '../tenant';
import { TenantCode } from '../tenant-code';
import { TenantId } from '../tenant-id';
import { TenantStatus } from '../tenant-status';

/**
 * Puerto del repositorio de Tenants.
 *
 * El dominio define este contrato; la infraestructura (Prisma adapter)
 * lo implementa. Sigue el patrón Repository agnóstico de tecnología.
 *
 * Particularidad de este BC: como Tenant Management opera ABOVE de los
 * tenants, los métodos NO requieren tenant context. El adapter Prisma
 * los implementa con `unsafeWithoutTenant()` documentado.
 *
 * El método save() persiste tanto el estado del agregado como sus
 * domain events pendientes (vía outbox), en la misma transacción.
 */
export interface TenantRepository {
  /** Busca por ID. Devuelve null si no existe (no lanza). */
  findById(id: TenantId): Promise<Tenant | null>;

  /** Busca por código natural. */
  findByCode(code: TenantCode): Promise<Tenant | null>;

  /** ¿Existe un tenant con este código (excluyendo eliminados)? */
  existsByCode(code: TenantCode): Promise<boolean>;

  /**
   * Persiste el agregado. Si version > 1 valida que la fila exista
   * con esa misma versión (optimistic concurrency); si no, lanza
   * ConcurrencyError. Drena los eventos del agregado y los escribe
   * en la outbox en la misma transacción.
   */
  save(tenant: Tenant): Promise<void>;

  /** Lista tenants con paginación; útil para Platform Admin console. */
  list(opts: TenantListOptions): Promise<TenantListResult>;
}

export interface TenantListOptions {
  status?: TenantStatus[];
  search?: string; // matchea code o name (ILIKE)
  page?: number;   // 1-based, default 1
  pageSize?: number; // default 20, max 100
  includeDeleted?: boolean; // default false
}

export interface TenantListResult {
  items: Tenant[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Token de inyección Nest. */
export const TENANT_REPOSITORY = Symbol('TenantRepository');
