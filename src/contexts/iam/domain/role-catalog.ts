/**
 * Catálogo central de roles de ELIZA (alineado con el Doc 11 — Seguridad).
 *
 * Convenciones:
 *   - Formato: `<Scope>.<Function>`
 *   - Platform.*  → opera sobre la plataforma SaaS (cross-tenant)
 *   - Tenant.*    → opera sobre su propio tenant
 *   - <Module>.*  → roles funcionales de cada módulo de negocio
 *
 * Cuando se asigna un rol a un usuario, en realidad se hace en Keycloak
 * (sea como realm role o como client role de eliza-api). Aquí solo
 * mantenemos el catálogo declarativo como contrato.
 */
export const PlatformRoles = {
  Admin: 'Platform.Admin',
  Support: 'Platform.Support',
  SRE: 'Platform.SRE',
} as const;

export const TenantRoles = {
  Admin: 'Tenant.Admin',
  Viewer: 'Tenant.Viewer',
} as const;

export const ModuleRoles = {
  Manufacturing: {
    Manager: 'Manufacturing.Manager',
    Supervisor: 'Manufacturing.Supervisor',
    Operator: 'Manufacturing.Operator',
  },
  Inventory: {
    Manager: 'Inventory.Manager',
    Operator: 'Inventory.Operator',
  },
  Sales: {
    Manager: 'Sales.Manager',
    Salesperson: 'Sales.Salesperson',
  },
  Quality: {
    Manager: 'Quality.Manager',
    Inspector: 'Quality.Inspector',
  },
  Procurement: {
    Manager: 'Procurement.Manager',
    Buyer: 'Procurement.Buyer',
  },
  Logistics: {
    Manager: 'Logistics.Manager',
    Driver: 'Logistics.Driver',
  },
  Billing: {
    Manager: 'Billing.Manager',
    Accountant: 'Billing.Accountant',
  },
} as const;

/** Conjunto completo de roles válidos en la plataforma. */
export const ALL_ROLES: ReadonlyArray<string> = Object.freeze([
  ...Object.values(PlatformRoles),
  ...Object.values(TenantRoles),
  ...Object.values(ModuleRoles).flatMap((m) => Object.values(m)),
]);

const ALL_ROLES_SET = new Set(ALL_ROLES);

export function isKnownRole(role: string): boolean {
  return ALL_ROLES_SET.has(role);
}

export function isPlatformRole(role: string): boolean {
  return role.startsWith('Platform.');
}
