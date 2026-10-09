import { Product, ProductType } from '@eliza/contexts/catalog/domain';

import { RenameProduct, SetProductPrice } from './product.use-cases';

/**
 * Fijar el mismo precio o el mismo nombre no cambia nada: responde OK sin guardar.
 * Antes intentaba guardar con version - 1 y terminaba en 500 (ProductVersionMismatchError).
 */
describe('Catálogo — operaciones sin cambios', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  function setup() {
    const p = Product.create({
      tenantId: '01a11e8a-0000-7004-80c9-000000000001', code: 'QA-AREPA-01', sku: 'QA-SKU-0001',
      name: 'Arepa QA x12', type: ProductType.FinishedGood, categoryId: '01a11e8a-0000-7004-80c9-000000000002',
      unitOfSaleId: '01a11e8a-0000-7004-80c9-000000000003', expiryDays: 180,
      storageTempMinC: -25, storageTempMaxC: -18, now,
    }).unwrap();
    p.setSalePrice(4500, now).unwrap();
    const repo = { findById: jest.fn().mockResolvedValue(p), save: jest.fn().mockResolvedValue(undefined) };
    const clock = { now: () => now, nowIso: () => now.toISOString() };
    return { p, repo, clock };
  }

  it('mismo precio de lista: OK y no guarda', async () => {
    const { p, repo, clock } = setup();
    const r = await new SetProductPrice(repo as never, clock as never).execute({ productId: p.id.value, salePrice: 4500 });
    expect(r.unwrap().salePrice).toBe(4500);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('precio distinto: guarda', async () => {
    const { p, repo, clock } = setup();
    await new SetProductPrice(repo as never, clock as never).execute({ productId: p.id.value, salePrice: 4800 });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('mismo nombre: OK y no guarda', async () => {
    const { p, repo, clock } = setup();
    const r = await new RenameProduct(repo as never, clock as never).execute({ productId: p.id.value, newName: 'Arepa QA x12' });
    expect(r.isOk).toBe(true);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
