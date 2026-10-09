import { Product, ProductType } from '@eliza/contexts/catalog/domain';
import { CondicionesPago, OrdenDeVenta } from '@eliza/contexts/sales/domain';

import { AddOrderLineUseCase } from './orden-venta.use-cases';

/**
 * Precio de lista (Sprint 10): el vendedor no fija precios; la línea toma el precio de lista
 * del catálogo. Solo gerente/admin pueden enviar otro precio.
 */
describe('AddOrderLineUseCase — precio de lista', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const tenantId = '01a11e8a-0000-7004-80c9-000000000001';
  const categoryId = '01a11e8a-0000-7004-80c9-000000000002';
  const uomId = '01a11e8a-0000-7004-80c9-000000000003';
  const clienteId = '01a11e8a-0000-7004-80c9-000000000004';

  function arepa(salePrice: number | null): Product {
    const p = Product.create({
      tenantId, code: 'QA-AREPA-01', sku: 'QA-SKU-0001', name: 'Arepa QA x12',
      type: ProductType.FinishedGood, categoryId, unitOfSaleId: uomId, taxRate: 19,
      expiryDays: 180, storageTempMinC: -25, storageTempMaxC: -18, now,
    }).unwrap();
    if (salePrice !== null) p.setSalePrice(salePrice, now).unwrap();
    return p;
  }

  function setup(product: Product) {
    const orden = OrdenDeVenta.create({
      tenantId, codigo: 'PV-QA-TEST-01', clienteId, clienteCodigo: 'CLI-QA-001',
      clienteRazonSocial: 'Cliente QA S.A.S.', condicionesPago: CondicionesPago.Contado,
      direccionEntrega: { direccion: 'Calle 10 # 20-30', ciudad: 'Bogota', departamento: 'Cundinamarca' },
      now,
    }).unwrap();
    const repo = { findById: jest.fn().mockResolvedValue(orden), save: jest.fn().mockResolvedValue(undefined) };
    const productRepo = { findById: jest.fn().mockResolvedValue(product) };
    const clock = { now: () => now, nowIso: () => now.toISOString() };
    const useCase = new AddOrderLineUseCase(repo as never, productRepo as never, clock as never);
    return { useCase, ordenId: orden.id.value, productId: product.id.value, repo };
  }

  it('el vendedor sin precio en la línea usa el precio de lista (12 × 4.500 + IVA 19 % = 64.260)', async () => {
    const { useCase, ordenId, productId } = setup(arepa(4500));
    const r = await useCase.execute({ ordenId, productId, cantidad: 12, puedeFijarPrecio: false });
    expect(r.isOk).toBe(true);
    const linea = r.unwrap().lineas[0]!;
    expect(linea.precioUnitario).toBe(4500);
    expect(linea.total).toBe(64260);
  });

  it('el vendedor que envía un precio recibe sales.price_not_allowed y no se guarda nada', async () => {
    const { useCase, ordenId, productId, repo } = setup(arepa(4500));
    const r = await useCase.execute({ ordenId, productId, cantidad: 12, precioUnitario: 1, puedeFijarPrecio: false });
    expect(r.isErr).toBe(true);
    expect(r.unwrapErr().code).toBe('sales.price_not_allowed');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('el gerente puede fijar otro precio (descuento autorizado)', async () => {
    const { useCase, ordenId, productId } = setup(arepa(4500));
    const r = await useCase.execute({ ordenId, productId, cantidad: 10, precioUnitario: 4000, puedeFijarPrecio: true });
    expect(r.unwrap().lineas[0]!.precioUnitario).toBe(4000);
  });

  it('un producto sin precio de lista no se puede agregar sin precio explícito', async () => {
    const { useCase, ordenId, productId } = setup(arepa(null));
    const r = await useCase.execute({ ordenId, productId, cantidad: 12, puedeFijarPrecio: false });
    expect(r.isErr).toBe(true);
    expect(r.unwrapErr().code).toBe('sales.product_without_price');
  });
});

describe('Product.setSalePrice', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const base = () =>
    Product.create({
      tenantId: '01a11e8a-0000-7004-80c9-000000000001', code: 'QA-X', sku: 'QA-X', name: 'X',
      type: ProductType.FinishedGood, categoryId: '01a11e8a-0000-7004-80c9-000000000002',
      unitOfSaleId: '01a11e8a-0000-7004-80c9-000000000003',
      expiryDays: 30, storageTempMinC: -25, storageTempMaxC: -18, now,
    }).unwrap();

  it('redondea a centavos, sube la versión y permite quitar el precio', () => {
    const p = base();
    const v0 = p.version;
    p.setSalePrice(4500.456, now).unwrap();
    expect(p.salePrice).toBe(4500.46);
    expect(p.version).toBe(v0 + 1);
    p.setSalePrice(null, now).unwrap();
    expect(p.salePrice).toBeNull();
  });

  it('rechaza precios no positivos', () => {
    expect(base().setSalePrice(0, now).isErr).toBe(true);
    expect(base().setSalePrice(-5, now).isErr).toBe(true);
  });
});
