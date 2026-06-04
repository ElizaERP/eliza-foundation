/**
 * TenantStatus — máquina de estados del tenant.
 *
 *   PendingActivation ──activate──▶ Active
 *                                     │
 *                                     ├──suspend──▶ Suspended
 *                                     │              │
 *                                     │              └──reactivate──▶ Active
 *                                     │
 *                                     └──delete──▶ Deleted (terminal)
 *                Suspended ──delete──▶ Deleted
 *           PendingActivation ──delete──▶ Deleted
 *
 * Reglas:
 *   - Una vez Deleted, no hay regreso.
 *   - No se puede suspender un tenant ya suspendido.
 *   - No se puede activar un tenant ya activo o eliminado.
 *
 * Las transiciones se validan en el agregado Tenant.canTransitionTo().
 */
export enum TenantStatus {
  PendingActivation = 'PendingActivation',
  Active = 'Active',
  Suspended = 'Suspended',
  Deleted = 'Deleted',
}

export const TENANT_STATUS_TRANSITIONS: Readonly<Record<TenantStatus, ReadonlyArray<TenantStatus>>> = Object.freeze({
  [TenantStatus.PendingActivation]: [TenantStatus.Active, TenantStatus.Deleted],
  [TenantStatus.Active]:            [TenantStatus.Suspended, TenantStatus.Deleted],
  [TenantStatus.Suspended]:         [TenantStatus.Active, TenantStatus.Deleted],
  [TenantStatus.Deleted]:           [], // estado terminal
});

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return TENANT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * TenantPlan — plan de suscripción del tenant.
 *
 * Cada plan habilita un conjunto de features y define límites de uso.
 * El catálogo detallado y el billing viven en el SubscriptionContext
 * (futuro), pero el Tenant aggregate guarda el plan vigente como
 * referencia denormalizada para resolución rápida en el AuthGuard.
 */
export enum TenantPlan {
  Basic = 'Basic',
  Professional = 'Professional',
  Enterprise = 'Enterprise',
}

export const TENANT_PLANS: ReadonlyArray<TenantPlan> = Object.freeze([
  TenantPlan.Basic,
  TenantPlan.Professional,
  TenantPlan.Enterprise,
]);
