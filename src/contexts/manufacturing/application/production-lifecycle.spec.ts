import { err, ok } from '@eliza/shared-kernel/domain';
import { EstadoOrdenProduccion, OrdenDeProduccion } from '@eliza/contexts/manufacturing/domain';

import {
  CancelProductionOrderUseCase,
  CompleteProductionOrderUseCase,
  ReserveMaterialsUseCase,
} from './orden-produccion.use-cases';

/**
 * Sprint 12: reservar materiales es todo o nada; completar descuenta del inventario
 * las materias primas reservadas (backflush) y registra un consumo por lote;
 * cancelar en proceso devuelve el stock reservado.
 */
describe('Órdenes de producción — reserva, consumo al completar y cancelación', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const HARINA = '01a11e8a-0000-7004-80c9-0000000000b1';
  const QUESO = '01a11e8a-0000-7004-80c9-0000000000b2';
  const clock = { now: () => now, nowIso: () => now.toISOString() };
  const ctx = { tryGetTenantId: () => '01a11e8a-0000-7004-80c9-000000000001', tryGetUserId: () => 'u-1' };

  function orden(): OrdenDeProduccion {
    return OrdenDeProduccion.create({
      tenantId: '01a11e8a-0000-7004-80c9-000000000001', codigo: 'OP-QA-TEST-01',
      productoTerminadoId: '01a11e8a-0000-7004-80c9-0000000000a1', productoTerminadoCode: 'QA-AREPA',
      productoTerminadoName: 'Arepa QA', cantidadObjetivo: 10,
      componentes: [
        { productId: HARINA, productCode: 'QA-MP-HARINA', productName: 'Harina QA', cantidadPorUnidad: 0.6, cantidadTotalRequerida: 6, unidadMedida: 'kg' },
        { productId: QUESO, productCode: 'QA-MP-QUESO', productName: 'Queso QA', cantidadPorUnidad: 0.3, cantidadTotalRequerida: 3, unidadMedida: 'kg' },
      ],
      now,
    }).unwrap();
  }

  function enProcesoConLote(): OrdenDeProduccion {
    const o = orden();
    o.markMaterialsReserved({ now }).unwrap();
    o.start({ iniciadoPor: 'u-1', now }).unwrap();
    o.recordProduction({ loteId: 'L-PT', codigoLote: 'PT-001', productId: o.productoTerminadoId, cantidad: 10, locationId: 'loc', movimientoId: 'm-pt', now }).unwrap();
    return o;
  }

  const repoDe = (o: OrdenDeProduccion) => ({ findById: jest.fn().mockResolvedValue(o), save: jest.fn().mockResolvedValue(undefined) });
  const releaseNoop = () => ({ execute: jest.fn().mockResolvedValue(err({ code: 'inventory.no_reservations_found', message: '', category: 'not_found' })) });

  describe('ReserveMaterials', () => {
    it('si el queso no alcanza: deshace la harina, no marca la orden y responde manufacturing.insufficient_stock', async () => {
      const o = orden();
      const repo = repoDe(o);
      const reserveStock = {
        execute: jest.fn().mockImplementation(async ({ productId, cantidad }: { productId: string; cantidad: number }) =>
          productId === QUESO
            ? err({ code: 'inventory.insufficient_stock', message: 'Insufficient', category: 'conflict' })
            : ok({ totalAsignado: cantidad, asignaciones: [], reservaIds: ['r1'] })),
      };
      const release = releaseNoop();
      const r = await new ReserveMaterialsUseCase(repo as never, reserveStock as never, release as never, clock as never, ctx as never)
        .execute({ ordenId: o.id.value });

      const e = r.unwrapErr();
      expect(e.code).toBe('manufacturing.insufficient_stock');
      expect(e.message).toContain('Queso QA');
      expect(e.message).toContain('3 kg');
      const deshechos = release.execute.mock.calls.map(([a]) => a).filter((a: { reason: string }) => a.reason.includes('se deshace'));
      expect(deshechos.map((a: { productId: string }) => a.productId)).toEqual([HARINA]);
      expect(o.materialesReservados).toBe(false);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('con stock: reserva los 2 componentes y marca la orden', async () => {
      const o = orden();
      const repo = repoDe(o);
      const reserveStock = { execute: jest.fn().mockResolvedValue(ok({ totalAsignado: 1, asignaciones: [], reservaIds: ['r'] })) };
      const r = await new ReserveMaterialsUseCase(repo as never, reserveStock as never, releaseNoop() as never, clock as never, ctx as never)
        .execute({ ordenId: o.id.value });
      expect(r.unwrap().componentesReservados).toBe(2);
      expect(o.materialesReservados).toBe(true);
    });
  });

  describe('CompleteProductionOrder (consumo automático)', () => {
    it('descuenta las reservas, registra un consumo por lote (harina en 2 lotes) y completa', async () => {
      const o = enProcesoConLote();
      const repo = repoDe(o);
      const dispatch = {
        execute: jest.fn().mockImplementation(async ({ productId }: { productId: string }) =>
          ok(productId === HARINA
            ? { totalDespachado: 6, movimientoIds: ['m1', 'm2'], detalle: [
                { movimientoId: 'm1', loteId: 'LH1', codigoLote: 'HAR-001', cantidad: 4 },
                { movimientoId: 'm2', loteId: 'LH2', codigoLote: 'HAR-002', cantidad: 2 }] }
            : { totalDespachado: 3, movimientoIds: ['m3'], detalle: [
                { movimientoId: 'm3', loteId: 'LQ1', codigoLote: 'QUE-001', cantidad: 3 }] })),
      };
      const r = await new CompleteProductionOrderUseCase(repo as never, dispatch as never, clock as never).execute({ ordenId: o.id.value });

      expect(r.unwrap().estado).toBe(EstadoOrdenProduccion.Completada);
      expect(o.consumos.map((c) => `${c.codigoLote}:${c.cantidad}${c.unidadMedida}`)).toEqual(['HAR-001:4kg', 'HAR-002:2kg', 'QUE-001:3kg']);
      // 3 consumos + completar = 4 guardados (uno por cambio de versión)
      expect(repo.save).toHaveBeenCalledTimes(4);
    });

    it('reintento: un componente ya consumido (sin reservas) se salta', async () => {
      const o = enProcesoConLote();
      const dispatch = {
        execute: jest.fn().mockImplementation(async ({ productId }: { productId: string }) =>
          productId === HARINA
            ? err({ code: 'inventory.no_reservations_to_dispatch', message: '', category: 'not_found' })
            : ok({ totalDespachado: 3, movimientoIds: ['m3'], detalle: [{ movimientoId: 'm3', loteId: 'LQ1', codigoLote: 'QUE-001', cantidad: 3 }] })),
      };
      const r = await new CompleteProductionOrderUseCase(repoDe(o) as never, dispatch as never, clock as never).execute({ ordenId: o.id.value });
      expect(r.isOk).toBe(true);
      expect(o.consumos).toHaveLength(1);
    });

    it('sin lotes producidos no completa ni toca el inventario', async () => {
      const o = orden();
      o.markMaterialsReserved({ now }).unwrap();
      o.start({ iniciadoPor: 'u-1', now }).unwrap();
      const dispatch = { execute: jest.fn() };
      const r = await new CompleteProductionOrderUseCase(repoDe(o) as never, dispatch as never, clock as never).execute({ ordenId: o.id.value });
      expect(r.unwrapErr().code).toBe('orden.no_lots_produced');
      expect(dispatch.execute).not.toHaveBeenCalled();
    });
  });

  it('cancelar una orden en proceso libera las reservas de sus materiales', async () => {
    const o = orden();
    o.markMaterialsReserved({ now }).unwrap();
    o.start({ iniciadoPor: 'u-1', now }).unwrap();
    const release = { execute: jest.fn().mockResolvedValue(ok({ released: 1 })) };
    const r = await new CancelProductionOrderUseCase(repoDe(o) as never, release as never, clock as never, ctx as never)
      .execute({ ordenId: o.id.value, motivo: 'Falla en la máquina' });
    expect(r.unwrap().estado).toBe(EstadoOrdenProduccion.Cancelada);
    expect(release.execute).toHaveBeenCalledTimes(2);
  });
});
