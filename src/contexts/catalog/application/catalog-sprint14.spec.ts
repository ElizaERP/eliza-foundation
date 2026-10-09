import { Product, ProductType } from '@eliza/contexts/catalog/domain';

import { SetBOM, SetProductPrice, UpdateProductDetails } from './product.use-cases';

/**
 * Sprint 14 — Catálogo desde la app:
 *   - Editar datos del producto (una sola versión, idempotente, reglas de cadena de frío).
 *   - Conflicto de versión → 412 con mensaje claro (antes 500).
 *   - Receta: sin componentes descontinuados ni ciclos.
 */
describe('Catálogo — Sprint 14', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const TENANT = '01a11e8a-0000-7004-80c9-000000000001';
  const CAT = '01a11e8a-0000-7004-80c9-000000000002';
  const UOM = '01a11e8a-0000-7004-80c9-000000000003';
  const clock = { now: () => now, nowIso: () => now.toISOString() };

  function terminado(code = 'QA-AREPA-01'): Product {
    return Product.create({
      tenantId: TENANT, code, sku: code, name: `Arepa ${code}`, type: ProductType.FinishedGood,
      categoryId: CAT, unitOfSaleId: UOM, expiryDays: 180, storageTempMinC: -25, storageTempMaxC: -18, now,
    }).unwrap();
  }
  function semi(code: string): Product {
    return Product.create({
      tenantId: TENANT, code, sku: code, name: `Masa ${code}`, type: ProductType.SemiFinished,
      categoryId: CAT, unitOfSaleId: UOM, isControlled: false, now,
    }).unwrap();
  }
  function materia(code: string): Product {
    return Product.create({
      tenantId: TENANT, code, sku: code, name: `MP ${code}`, type: ProductType.RawMaterial,
      categoryId: CAT, unitOfSaleId: UOM, now,
    }).unwrap();
  }
  const repoDe = (p: Product, otros: Product[] = []) => ({
    findById: jest.fn().mockResolvedValue(p),
    findByIds: jest.fn().mockImplementation(async (ids: string[]) => [p, ...otros].filter((x) => ids.includes(x.id.value))),
    save: jest.fn().mockResolvedValue(undefined),
  });

  // -------------------------------------------------------------------
  describe('Editar datos', () => {
    it('nombre, vida útil, temperatura e IVA en una sola versión', async () => {
      const p = terminado();
      const repo = repoDe(p);
      const v = (await new UpdateProductDetails(repo as never, clock as never).execute({
        productId: p.id.value, name: 'Arepa de queso x12', expiryDays: 120,
        storageTempMinC: -20, storageTempMaxC: -16, taxRate: 19, barcode: '7702345001234',
      })).unwrap();
      expect(v).toEqual(expect.objectContaining({
        name: 'Arepa de queso x12', expiryDays: 120, storageTempMinC: -20, storageTempMaxC: -16, taxRate: 19, barcode: '7702345001234',
      }));
      expect(v.version).toBe(2);
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('sin cambios: OK y no guarda', async () => {
      const p = terminado();
      const repo = repoDe(p);
      const r = await new UpdateProductDetails(repo as never, clock as never).execute({
        productId: p.id.value, name: p.name, expiryDays: 180, storageTempMinC: -25, storageTempMaxC: -18,
      });
      expect(r.isOk).toBe(true);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('producto con cadena de frío: no puede quedar sin vida útil', async () => {
      const p = terminado();
      const r = await new UpdateProductDetails(repoDe(p) as never, clock as never).execute({ productId: p.id.value, expiryDays: null });
      expect(r.unwrapErr().code).toBe('product.controlled_requires_metadata');
    });

    it('temperatura incompleta: inválido', async () => {
      const p = semi('QA-MASA-01');
      const r = await new UpdateProductDetails(repoDe(p) as never, clock as never).execute({ productId: p.id.value, storageTempMinC: -5 });
      expect(r.unwrapErr().code).toBe('product.temperature_incomplete');
    });

    it('null borra el campo (código de barras)', async () => {
      const p = semi('QA-MASA-02');
      p.updateDetails({ barcode: '12345678', now }).unwrap();
      const v = (await new UpdateProductDetails(repoDe(p) as never, clock as never).execute({ productId: p.id.value, barcode: null })).unwrap();
      expect(v.barcode).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  it('conflicto de versión al guardar → product.version_conflict (412), no 500', async () => {
    const p = terminado();
    const repo = repoDe(p);
    const e = new Error('mismatch');
    e.name = 'ProductVersionMismatchError';
    repo.save.mockRejectedValue(e);
    const r = await new SetProductPrice(repo as never, clock as never).execute({ productId: p.id.value, salePrice: 5000, expectedVersion: 7 });
    const er = r.unwrapErr();
    expect(er.code).toBe('product.version_conflict');
    expect(er.category).toBe('concurrency');
  });

  // -------------------------------------------------------------------
  describe('Receta (BOM)', () => {
    const uoms = { findByIds: jest.fn().mockResolvedValue([{ id: { value: UOM } }]) };

    it('con materias primas activas: guarda', async () => {
      const pt = terminado();
      const harina = materia('QA-MP-HARINA');
      const repo = repoDe(pt, [harina]);
      const r = await new SetBOM(repo as never, uoms as never, clock as never).execute({
        productId: pt.id.value, components: [{ componentProductId: harina.id.value, quantity: 0.6, uomId: UOM }],
      });
      expect(r.unwrap().components).toHaveLength(1);
    });

    it('componente descontinuado: inválido', async () => {
      const pt = terminado();
      const harina = materia('QA-MP-HARINA');
      harina.discontinue('Proveedor cerró', now).unwrap();
      const r = await new SetBOM(repoDe(pt, [harina]) as never, uoms as never, clock as never).execute({
        productId: pt.id.value, components: [{ componentProductId: harina.id.value, quantity: 1, uomId: UOM }],
      });
      expect(r.unwrapErr().code).toBe('product.bom_discontinued_component');
    });

    it('ciclo indirecto (A usa B, B usa C, C usaría A): inválido', async () => {
      const a = semi('QA-SEMI-A');
      const b = semi('QA-SEMI-B');
      const c = semi('QA-SEMI-C');
      a.setBOM({ components: [{ componentProductId: b.id.value, quantity: 1, uomId: UOM }], now }).unwrap();
      b.setBOM({ components: [{ componentProductId: c.id.value, quantity: 1, uomId: UOM }], now }).unwrap();
      const repo = repoDe(c, [a, b]);
      const r = await new SetBOM(repo as never, uoms as never, clock as never).execute({
        productId: c.id.value, components: [{ componentProductId: a.id.value, quantity: 1, uomId: UOM }],
      });
      const er = r.unwrapErr();
      expect(er.code).toBe('product.bom_cycle');
      expect(er.message).toContain(a.name);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
