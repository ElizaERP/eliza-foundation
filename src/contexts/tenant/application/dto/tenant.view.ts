import { Tenant, TenantPlan, TenantStatus } from '../../domain';

/**
 * DTO interno de aplicación. La capa de interfaz HTTP define su propio
 * DTO de presentación con decoradores OpenAPI; esto evita acoplar el
 * dominio al transporte.
 */
export interface TenantView {
  id: string;
  code: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt: string | null;
  version: number;
}

export function toTenantView(tenant: Tenant): TenantView {
  return {
    id: tenant.id.value,
    code: tenant.code.value,
    name: tenant.name.value,
    status: tenant.status,
    plan: tenant.plan,
    createdAt: tenant.createdAt.toISOString(),
    createdBy: tenant.createdBy,
    updatedAt: tenant.updatedAt.toISOString(),
    updatedBy: tenant.updatedBy,
    deletedAt: tenant.deletedAt?.toISOString() ?? null,
    version: tenant.version,
  };
}
