import {
  Tenant,
  TenantCode,
  TenantName,
  TenantPlan,
  TenantStatus,
} from './';

describe('Tenant aggregate', () => {
  const baseDate = new Date('2026-06-03T12:00:00Z');
  const adminId = '00000000-0000-0000-0000-000000000001';

  const codeResult = TenantCode.create('acme-corp');
  const nameResult = TenantName.create('ACME Corporation');
  if (codeResult.isErr || nameResult.isErr) throw new Error('Test setup failed');
  const code = codeResult.value;
  const name = nameResult.value;

  function newTenant() {
    const result = Tenant.create({
      code,
      name,
      createdBy: adminId,
      now: baseDate,
    });
    if (result.isErr) throw new Error('Tenant.create failed');
    return result.value;
  }

  describe('create', () => {
    it('emits TenantCreated on creation', () => {
      const tenant = newTenant();
      const events = tenant.peekDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].metadata.eventType).toBe('tenant.TenantCreated.v1');
    });

    it('starts in PendingActivation with Basic plan by default', () => {
      const tenant = newTenant();
      expect(tenant.status).toBe(TenantStatus.PendingActivation);
      expect(tenant.plan).toBe(TenantPlan.Basic);
      expect(tenant.version).toBe(1);
    });

    it('respects the provided plan', () => {
      const result = Tenant.create({
        code,
        name,
        plan: TenantPlan.Enterprise,
        createdBy: adminId,
        now: baseDate,
      });
      expect(result.isOk).toBe(true);
      if (result.isOk) {
        expect(result.value.plan).toBe(TenantPlan.Enterprise);
      }
    });
  });

  describe('activate', () => {
    it('moves PendingActivation → Active and emits TenantActivated', () => {
      const tenant = newTenant();
      tenant.pullDomainEvents(); // drain create event

      const result = tenant.activate({
        activatedBy: adminId,
        now: new Date('2026-06-03T13:00:00Z'),
      });

      expect(result.isOk).toBe(true);
      expect(tenant.status).toBe(TenantStatus.Active);
      expect(tenant.version).toBe(2);

      const events = tenant.peekDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].metadata.eventType).toBe('tenant.TenantActivated.v1');
    });

    it('moves Suspended → Active and emits TenantReactivated', () => {
      const tenant = newTenant();
      tenant.activate({ activatedBy: adminId, now: baseDate });
      tenant.suspend({ reason: 'test', suspendedBy: adminId, now: baseDate });
      tenant.pullDomainEvents();

      const result = tenant.activate({ activatedBy: adminId, now: baseDate });

      expect(result.isOk).toBe(true);
      expect(tenant.status).toBe(TenantStatus.Active);

      const events = tenant.peekDomainEvents();
      expect(events[0].metadata.eventType).toBe('tenant.TenantReactivated.v1');
    });

    it('rejects activating an already-Active tenant', () => {
      const tenant = newTenant();
      tenant.activate({ activatedBy: adminId, now: baseDate });

      const result = tenant.activate({ activatedBy: adminId, now: baseDate });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe('tenant.already_active');
    });

    it('rejects activating a Deleted tenant', () => {
      const tenant = newTenant();
      tenant.delete({ deletedBy: adminId, now: baseDate });

      const result = tenant.activate({ activatedBy: adminId, now: baseDate });

      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe('tenant.already_deleted');
    });
  });

  describe('suspend', () => {
    it('moves Active → Suspended with the suspension reason', () => {
      const tenant = newTenant();
      tenant.activate({ activatedBy: adminId, now: baseDate });
      tenant.pullDomainEvents();

      const result = tenant.suspend({
        reason: 'Non-payment > 30 days',
        suspendedBy: adminId,
        now: baseDate,
      });

      expect(result.isOk).toBe(true);
      expect(tenant.status).toBe(TenantStatus.Suspended);
    });

    it('rejects suspending a PendingActivation tenant', () => {
      const tenant = newTenant();
      const result = tenant.suspend({
        reason: 'test',
        suspendedBy: adminId,
        now: baseDate,
      });
      expect(result.isErr).toBe(true);
    });

    it('rejects re-suspending an already suspended tenant', () => {
      const tenant = newTenant();
      tenant.activate({ activatedBy: adminId, now: baseDate });
      tenant.suspend({ reason: 'a', suspendedBy: adminId, now: baseDate });

      const result = tenant.suspend({
        reason: 'b',
        suspendedBy: adminId,
        now: baseDate,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe('tenant.already_suspended');
    });
  });

  describe('changePlan', () => {
    it('changes the plan and emits TenantPlanChanged', () => {
      const tenant = newTenant();
      tenant.activate({ activatedBy: adminId, now: baseDate });
      tenant.pullDomainEvents();

      const result = tenant.changePlan({
        newPlan: TenantPlan.Enterprise,
        changedBy: adminId,
        now: baseDate,
      });

      expect(result.isOk).toBe(true);
      expect(tenant.plan).toBe(TenantPlan.Enterprise);

      const events = tenant.peekDomainEvents();
      expect(events[0].metadata.eventType).toBe('tenant.TenantPlanChanged.v1');
    });

    it('rejects changing to the same plan', () => {
      const tenant = newTenant();
      tenant.activate({ activatedBy: adminId, now: baseDate });

      const result = tenant.changePlan({
        newPlan: TenantPlan.Basic,
        changedBy: adminId,
        now: baseDate,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe('tenant.same_plan');
    });

    it('rejects changing the plan while PendingActivation', () => {
      const tenant = newTenant();
      const result = tenant.changePlan({
        newPlan: TenantPlan.Enterprise,
        changedBy: adminId,
        now: baseDate,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe('tenant.cannot_change_plan');
    });
  });

  describe('delete', () => {
    it('marks the tenant as Deleted and is terminal', () => {
      const tenant = newTenant();
      tenant.activate({ activatedBy: adminId, now: baseDate });

      const deleteResult = tenant.delete({ deletedBy: adminId, now: baseDate });
      expect(deleteResult.isOk).toBe(true);
      expect(tenant.status).toBe(TenantStatus.Deleted);
      expect(tenant.deletedAt).toEqual(baseDate);

      const reactivate = tenant.activate({ activatedBy: adminId, now: baseDate });
      expect(reactivate.isErr).toBe(true);
    });
  });

  describe('version', () => {
    it('increments version on each state-changing operation', () => {
      const tenant = newTenant();
      expect(tenant.version).toBe(1);

      tenant.activate({ activatedBy: adminId, now: baseDate });
      expect(tenant.version).toBe(2);

      tenant.changePlan({
        newPlan: TenantPlan.Professional,
        changedBy: adminId,
        now: baseDate,
      });
      expect(tenant.version).toBe(3);

      tenant.suspend({ reason: 'x', suspendedBy: adminId, now: baseDate });
      expect(tenant.version).toBe(4);
    });
  });
});
