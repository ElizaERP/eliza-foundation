import {
  Tenant as PrismaTenant,
  TenantPlan as PrismaTenantPlan,
  TenantStatus as PrismaTenantStatus,
} from '@prisma/client';

import {
  Tenant,
  TenantCode,
  TenantId,
  TenantName,
  TenantPlan,
  TenantStatus,
} from '../../domain';

/**
 * Mapper Tenant: Domain ↔ Prisma.
 *
 * Aislar el modelo de dominio del esquema relacional permite que ambos
 * evolucionen independientemente. Si mañana añadimos una columna en
 * Prisma o cambiamos el storage, el dominio no se entera.
 *
 * Convención: lanza Error (no Result) si la fila de la BD viola un
 * invariante del dominio. Eso indicaría corrupción de datos — un bug
 * real, no un error esperable.
 */
export class TenantMapper {
  static toDomain(row: PrismaTenant): Tenant {
    const code = TenantCode.create(row.code);
    if (code.isErr) {
      throw new Error(
        `Persisted Tenant ${row.id} has invalid code '${row.code}': ${code.error.message}`,
      );
    }

    const name = TenantName.create(row.name);
    if (name.isErr) {
      throw new Error(
        `Persisted Tenant ${row.id} has invalid name: ${name.error.message}`,
      );
    }

    return Tenant.reconstitute({
      id: TenantId.fromString(row.id),
      code: code.value,
      name: name.value,
      status: this.statusToDomain(row.status),
      plan: this.planToDomain(row.plan),
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      deletedAt: row.deletedAt,
      deletedBy: row.deletedBy,
      version: row.version,
    });
  }

  static toPersistence(tenant: Tenant): {
    id: string;
    code: string;
    name: string;
    status: PrismaTenantStatus;
    plan: PrismaTenantPlan;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
    deletedAt: Date | null;
    deletedBy: string | null;
    version: number;
  } {
    return {
      id: tenant.id.value,
      code: tenant.code.value,
      name: tenant.name.value,
      status: this.statusToPrisma(tenant.status),
      plan: this.planToPrisma(tenant.plan),
      createdAt: tenant.createdAt,
      createdBy: tenant.createdBy,
      updatedAt: tenant.updatedAt,
      updatedBy: tenant.updatedBy,
      deletedAt: tenant.deletedAt,
      deletedBy: tenant.deletedBy,
      version: tenant.version,
    };
  }

  private static statusToDomain(s: PrismaTenantStatus): TenantStatus {
    return s as unknown as TenantStatus;
  }

  private static statusToPrisma(s: TenantStatus): PrismaTenantStatus {
    return s as unknown as PrismaTenantStatus;
  }

  private static planToDomain(p: PrismaTenantPlan): TenantPlan {
    return p as unknown as TenantPlan;
  }

  private static planToPrisma(p: TenantPlan): PrismaTenantPlan {
    return p as unknown as PrismaTenantPlan;
  }
}
