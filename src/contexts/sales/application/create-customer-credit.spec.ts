import { CondicionesPago } from '@eliza/contexts/sales/domain';

import { CreateCustomerUseCase } from './cliente.use-cases';

/** Sprint 10: el vendedor registra clientes solo a Contado; el crédito lo otorga el gerente. */
describe('CreateCustomerUseCase — condiciones de pago según el rol', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const base = {
    codigo: 'CLI-M-TEST-001', nit: '900765432-1', razonSocial: 'Tienda Nueva S.A.S.',
    direccionFiscal: { direccion: 'Calle 45 # 12-30', ciudad: 'Bogota', departamento: 'Cundinamarca' },
  };
  function setup() {
    const repo = {
      findByCodigo: jest.fn().mockResolvedValue(null),
      findByNit: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const clock = { now: () => now, nowIso: () => now.toISOString() };
    const ctx = { tryGetTenantId: () => '01a11e8a-0000-7004-80c9-000000000001', tryGetUserId: () => 'u' };
    return { useCase: new CreateCustomerUseCase(repo as never, clock as never, ctx as never), repo };
  }

  it('el vendedor registra a Contado (sin indicar condiciones)', async () => {
    const { useCase } = setup();
    const r = await useCase.execute({ ...base, puedeOtorgarCredito: false });
    expect(r.unwrap().condicionesPago).toBe(CondicionesPago.Contado);
  });

  it('el vendedor no puede dar crédito: sales.credit_not_allowed y no se guarda', async () => {
    const { useCase, repo } = setup();
    const r = await useCase.execute({ ...base, condicionesPago: CondicionesPago.Credito30, puedeOtorgarCredito: false });
    expect(r.isErr).toBe(true);
    expect(r.unwrapErr().code).toBe('sales.credit_not_allowed');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('el gerente sí puede registrar con crédito', async () => {
    const { useCase } = setup();
    const r = await useCase.execute({ ...base, condicionesPago: CondicionesPago.Credito30, puedeOtorgarCredito: true });
    expect(r.unwrap().condicionesPago).toBe(CondicionesPago.Credito30);
  });
});
