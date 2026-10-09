import { EntityName, Product, ProductType, UnitOfMeasure, UnitOfMeasureId, UomDimension } from '@eliza/contexts/catalog/domain';
import { EstadoOrdenProduccion, OrdenDeProduccion } from '@eliza/contexts/manufacturing/domain';

import { CreateProductionOrderUseCase } from './orden-produccion.use-cases';

/**
 * Regresión: el snapshot del BOM se armaba leyendo las entidades de dominio del Catálogo
 * como si fueran filas de Prisma (Number(Quantity) = NaN, ids como objetos), y la reserva
 * de materiales fallaba con "Cantidad must be strictly positive".
 */
describe('CreateProductionOrderUseCase — snapshot del BOM', () => {
  const now = new Date('2026-10-09T03:00:00Z');
  const tenantId = '01a11e8a-0000-7004-80c9-000000000001';
  const categoryId = '01a11e8a-0000-7004-80c9-000000000002';
  const kgId = '01a11e8a-0000-7004-80c9-000000000003';

  function product(code: string, name: string, type: ProductType): Product {
    return Product.create({
      tenantId, code, sku: `SKU-${code}`, name, type, categoryId, unitOfSaleId: kgId,
      expiryDays: 30, storageTempMinC: -25, storageTempMaxC: -18, now,
    }).unwrap();
  }

  it('usa la cantidad, el código, el nombre y la unidad reales de cada componente', async () => {
    const harina = product('QA-MP-HARINA', 'Harina de maiz QA', ProductType.RawMaterial);
    const queso = product('QA-MP-QUESO', 'Queso fresco QA', ProductType.RawMaterial);
    const arepa = product('QA-AREPA-01', 'Arepa QA x12', ProductType.FinishedGood);
    arepa.setBOM({
      components: [
        { componentProductId: harina.id.value, quantity: 0.6, uomId: kgId, position: 0 },
        { componentProductId: queso.id.value, quantity: 0.3, uomId: kgId, position: 1 },
      ],
      now,
    }).unwrap();
    const kg = UnitOfMeasure.reconstitute(UnitOfMeasureId.fromString(kgId), {
      code: 'kg', name: EntityName.create('Kilogramo').unwrap(), symbol: 'kg',
      dimension: UomDimension.Mass, toBaseFactor: 1000, isActive: true,
    });

    const saved: OrdenDeProduccion[] = [];
    const repo = { findByCodigo: jest.fn().mockResolvedValue(null), save: jest.fn(async (o: OrdenDeProduccion) => { saved.push(o); }) };
    const productRepo = {
      findById: jest.fn().mockResolvedValue(arepa),
      findByIds: jest.fn().mockResolvedValue([harina, queso]),
    };
    const uomRepo = { findByIds: jest.fn().mockResolvedValue([kg]) };
    const clock = { now: () => now, nowIso: () => now.toISOString() };
    const ctx = { tryGetTenantId: () => tenantId, tryGetUserId: () => 'qa-admin' };

    const useCase = new CreateProductionOrderUseCase(
      repo as never, productRepo as never, uomRepo as never, clock as never, ctx as never,
    );
    const r = await useCase.execute({ codigo: 'OP-QA-TEST-01', productoTerminadoId: arepa.id.value, cantidadObjetivo: 30 });

    expect(r.isOk).toBe(true);
    const view = r.unwrap();
    expect(view.estado).toBe(EstadoOrdenProduccion.Planificada);
    expect(view.componentes).toEqual([
      { productId: harina.id.value, productCode: 'QA-MP-HARINA', productName: 'Harina de maiz QA',
        cantidadPorUnidad: 0.6, cantidadTotalRequerida: 18, unidadMedida: 'kg' },
      { productId: queso.id.value, productCode: 'QA-MP-QUESO', productName: 'Queso fresco QA',
        cantidadPorUnidad: 0.3, cantidadTotalRequerida: 9, unidadMedida: 'kg' },
    ]);
    expect(productRepo.findByIds).toHaveBeenCalledWith([harina.id.value, queso.id.value]);
    expect(saved).toHaveLength(1);
  });
});
