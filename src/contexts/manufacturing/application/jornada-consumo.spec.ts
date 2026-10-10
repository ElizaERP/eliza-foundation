import { err, ok } from '@eliza/shared-kernel/domain';
import { EstadoOrdenProduccion, OrdenDeProduccion } from '@eliza/contexts/manufacturing/domain';

import { CompleteProductionOrderUseCase } from './orden-produccion.use-cases';
import { CreateJornadaUseCase, ReserveJornadaUseCase, estadoJornada, nuevoCodigoJornada } from './jornada.use-cases';

/**
 * Sprint 15 — Producción:
 *   - Completar descuenta lo que de verdad se gastó (receta × producido, o lo
 *     que corrige el operario), no lo reservado para la cantidad objetivo.
 *   - Jornadas: varios productos; reservar es todo o nada entre productos.
 */
describe('Producción — consumo real y jornadas', () => {
  const now = new Date('2026-10-10T14:30:00Z');
  const TENANT = '01a11e8a-0000-7004-80c9-000000000001';
  const HARINA = '01a11e8a-0000-7004-80c9-0000000000b1';
  const QUESO = '01a11e8a-0000-7004-80c9-0000000000b2';
  const clock = { now: () => now, nowIso: () => now.toISOString() };
  const ctx = { tryGetTenantId: () => TENANT, tryGetUserId: () => 'u-1' };

  function orden(codigo = 'OP-QA-01', objetivo = 10): OrdenDeProduccion {
    return OrdenDeProduccion.create({
      tenantId: TENANT, codigo, productoTerminadoId: '01a11e8a-0000-7004-80c9-0000000000a1',
      productoTerminadoCode: 'QA-AREPA', productoTerminadoName: `Arepa ${codigo}`, cantidadObjetivo: objetivo,
      componentes: [
        { productId: HARINA, productCode: 'MP-HARINA', productName: 'Harina', cantidadPorUnidad: 0.6, cantidadTotalRequerida: Math.round(0.6 * objetivo * 1e6) / 1e6, unidadMedida: 'kg' },
        { productId: QUESO, productCode: 'MP-QUESO', productName: 'Queso', cantidadPorUnidad: 0.3, cantidadTotalRequerida: Math.round(0.3 * objetivo * 1e6) / 1e6, unidadMedida: 'kg' },
      ],
      now,
    }).unwrap();
  }
  function enProceso(producido: number): OrdenDeProduccion {
    const o = orden();
    o.markMaterialsReserved({ now }).unwrap();
    o.start({ iniciadoPor: 'u-1', now }).unwrap();
    o.recordProduction({ loteId: 'L-PT', codigoLote: 'PT-1', productId: o.productoTerminadoId, cantidad: producido, locationId: 'loc', movimientoId: 'm', now }).unwrap();
    return o;
  }
  const repoDe = (o: OrdenDeProduccion) => ({ findById: jest.fn().mockResolvedValue(o), save: jest.fn().mockResolvedValue(undefined) });
  /** dispatch devuelve lo último reservado para ese producto (o lo planeado si no se re-reservó). */
  function inventario(o: OrdenDeProduccion, opts: { sinStockPara?: string } = {}) {
    const reservado = new Map(o.componentes.map((c) => [c.productId, c.cantidadTotalRequerida]));
    const reserve = {
      execute: jest.fn().mockImplementation(async ({ productId, cantidad }: { productId: string; cantidad: number }) => {
        if (opts.sinStockPara === productId && cantidad > (o.componentes.find((c) => c.productId === productId)!.cantidadTotalRequerida)) {
          return err({ code: 'inventory.insufficient_stock', message: 'no', category: 'conflict' });
        }
        reservado.set(productId, cantidad);
        return ok({ totalAsignado: cantidad, asignaciones: [], reservaIds: ['r'] });
      }),
    };
    const release = {
      execute: jest.fn().mockImplementation(async ({ productId }: { productId: string }) => {
        reservado.set(productId, 0);
        return ok({ released: 1 });
      }),
    };
    const dispatch = {
      execute: jest.fn().mockImplementation(async ({ productId }: { productId: string }) => {
        const q = reservado.get(productId) ?? 0;
        if (q === 0) return err({ code: 'inventory.no_reservations_to_dispatch', message: '', category: 'not_found' });
        return ok({ totalDespachado: q, movimientoIds: ['m'], detalle: [{ movimientoId: `m-${productId}`, loteId: `L-${productId}`, codigoLote: `LOT-${productId.slice(-2)}`, cantidad: q }] });
      }),
    };
    return { reserve, release, dispatch };
  }
  const completar = (o: OrdenDeProduccion, inv: ReturnType<typeof inventario>, repo = repoDe(o)) =>
    new CompleteProductionOrderUseCase(repo as never, inv.dispatch as never, inv.reserve as never, inv.release as never, clock as never);
  const consumoDe = (o: OrdenDeProduccion, productId: string) =>
    o.consumos.filter((c) => c.productId === productId).reduce((s, c) => s + c.cantidad, 0);

  // -------------------------------------------------------------------
  describe('Completar con consumo real', () => {
    it('produjo 8 de 10: descuenta receta × 8 (4,8 kg harina, 2,4 kg queso) y devuelve el resto', async () => {
      const o = enProceso(8);
      const inv = inventario(o);
      const r = await completar(o, inv).execute({ ordenId: o.id.value });
      expect(r.unwrap().estado).toBe(EstadoOrdenProduccion.Completada);
      expect(consumoDe(o, HARINA)).toBeCloseTo(4.8);
      expect(consumoDe(o, QUESO)).toBeCloseTo(2.4);
      expect(inv.release.execute).toHaveBeenCalledTimes(2);
    });

    it('produjo exactamente lo planeado: despacha la reserva sin liberar ni re-reservar', async () => {
      const o = enProceso(10);
      const inv = inventario(o);
      await completar(o, inv).execute({ ordenId: o.id.value });
      expect(consumoDe(o, HARINA)).toBeCloseTo(6);
      expect(inv.release.execute).not.toHaveBeenCalled();
      expect(inv.reserve.execute).not.toHaveBeenCalled();
    });

    it('el operario corrige: harina 5,5 (merma) y queso 0 (no se usó)', async () => {
      const o = enProceso(10);
      const inv = inventario(o);
      await completar(o, inv).execute({ ordenId: o.id.value, consumos: [{ productId: HARINA, cantidad: 5.5 }, { productId: QUESO, cantidad: 0 }] });
      expect(consumoDe(o, HARINA)).toBeCloseTo(5.5);
      expect(consumoDe(o, QUESO)).toBe(0);
      expect(o.estado).toBe(EstadoOrdenProduccion.Completada);
    });

    it('produjo 12 y no hay más queso: no completa y vuelve a apartar lo reservado', async () => {
      const o = enProceso(12);
      const inv = inventario(o, { sinStockPara: QUESO });
      const repo = repoDe(o);
      const r = await completar(o, inv, repo).execute({ ordenId: o.id.value });
      const e = r.unwrapErr();
      expect(e.code).toBe('manufacturing.insufficient_stock');
      expect(e.message).toContain('Queso');
      // re-reserva de lo original (3 kg)
      const llamadas = (inv.reserve.execute.mock.calls as Array<[{ productId: string; cantidad: number }]>).map(([a]) => a);
      expect(llamadas.filter((a) => a.productId === QUESO).map((a) => a.cantidad)).toEqual([3.6, 3]);
      expect(o.estado).toBe(EstadoOrdenProduccion.EnProceso);
    });

    it('consumo de algo que no está en la receta: inválido', async () => {
      const o = enProceso(10);
      const r = await completar(o, inventario(o)).execute({ ordenId: o.id.value, consumos: [{ productId: '01a11e8a-0000-7004-80c9-0000000000ff', cantidad: 1 }] });
      expect(r.unwrapErr().code).toBe('manufacturing.consumption_not_in_bom');
    });
  });

  // -------------------------------------------------------------------
  describe('Jornadas', () => {
    it('código JP-AAMMDD-HHMM-XXX', () => {
      expect(nuevoCodigoJornada(now, () => 0)).toBe('JP-261010-1430-AAA');
    });

    it('estado: en proceso si alguna arrancó; completada si todas las vivas terminaron', () => {
      const E = EstadoOrdenProduccion;
      expect(estadoJornada([{ estado: E.Planificada }, { estado: E.Planificada }])).toBe('Planificada');
      expect(estadoJornada([{ estado: E.EnProceso }, { estado: E.Planificada }])).toBe('EnProceso');
      expect(estadoJornada([{ estado: E.Completada }, { estado: E.Cancelada }])).toBe('Completada');
      expect(estadoJornada([{ estado: E.Cancelada }])).toBe('Cancelada');
    });

    it('crear: si un producto no tiene receta no crea ninguna orden', async () => {
      const conReceta = { id: { value: 'p1' }, name: 'Arepa queso', code: 'PT-1', status: 'Active', components: [{}] };
      const sinReceta = { id: { value: 'p2' }, name: 'Arepa chócolo', code: 'PT-2', status: 'Active', components: [] };
      const productRepo = { findByIds: jest.fn().mockResolvedValue([conReceta, sinReceta]) };
      const createOrder = { execute: jest.fn() };
      const r = await new CreateJornadaUseCase({} as never, productRepo as never, createOrder as never, {} as never, clock as never, ctx as never)
        .execute({ lineas: [{ productoTerminadoId: 'p1', cantidadObjetivo: 500 }, { productoTerminadoId: 'p2', cantidadObjetivo: 300 }] });
      expect(r.unwrapErr().code).toBe('manufacturing.no_bom');
      expect(r.unwrapErr().message).toContain('chócolo');
      expect(createOrder.execute).not.toHaveBeenCalled();
    });

    it('crear: una orden por producto, códigos OP-…-01, -02 con la misma jornada', async () => {
      const prod = (id: string) => ({ id: { value: id }, name: id, code: id, status: 'Active', components: [{}] });
      const productRepo = { findByIds: jest.fn().mockResolvedValue([prod('p1'), prod('p2')]) };
      const creadas: OrdenDeProduccion[] = [];
      const createOrder = {
        execute: jest.fn().mockImplementation(async (i: { codigo: string; cantidadObjetivo: number; jornada: string }) => {
          const o = OrdenDeProduccion.create({ tenantId: TENANT, codigo: i.codigo, productoTerminadoId: 'x', productoTerminadoCode: 'x', productoTerminadoName: 'x', cantidadObjetivo: i.cantidadObjetivo, componentes: [...orden().componentes], jornada: i.jornada, now }).unwrap();
          creadas.push(o);
          return ok({ codigo: i.codigo });
        }),
      };
      const repo = { countBy: jest.fn().mockResolvedValue(0), findByCodigo: jest.fn().mockImplementation(async (c: string) => creadas.find((o) => o.codigo === c)) };
      const v = (await new CreateJornadaUseCase(repo as never, productRepo as never, createOrder as never, {} as never, clock as never, ctx as never)
        .execute({ lineas: [{ productoTerminadoId: 'p1', cantidadObjetivo: 500 }, { productoTerminadoId: 'p2', cantidadObjetivo: 300 }] })).unwrap();
      expect(v.ordenes).toHaveLength(2);
      const base = v.codigo.slice(3);
      expect(v.ordenes.map((o) => o.codigo)).toEqual([`OP-${base}-01`, `OP-${base}-02`]);
      expect(v.ordenes.every((o) => o.jornada === v.codigo)).toBe(true);
      expect(v.estado).toBe('Planificada');
    });

    it('reservar: si el segundo producto no alcanza, devuelve la reserva del primero', async () => {
      const a = orden('OP-QA-A');
      const b = orden('OP-QA-B');
      const repo = {
        list: jest.fn().mockResolvedValue([a, b]),
        findById: jest.fn().mockImplementation(async (id: { value: string }) => (id.value === a.id.value ? a : b)),
        save: jest.fn(),
      };
      const reserveMaterials = {
        execute: jest.fn().mockImplementation(async ({ ordenId }: { ordenId: string }) => {
          if (ordenId === a.id.value) { a.markMaterialsReserved({ now }).unwrap(); return ok({}); }
          return err({ code: 'manufacturing.insufficient_stock', message: 'No hay stock suficiente de Queso.', category: 'conflict' });
        }),
      };
      const release = { execute: jest.fn().mockResolvedValue(ok({ released: 1 })) };
      const r = await new ReserveJornadaUseCase(repo as never, reserveMaterials as never, release as never, clock as never).execute({ codigo: 'JP-261010-1430-AAA' });
      const e = r.unwrapErr();
      expect(e.code).toBe('manufacturing.insufficient_stock');
      expect(e.message).toContain('Arepa OP-QA-B');
      expect(release.execute).toHaveBeenCalledTimes(2); // las 2 materias primas de A
      expect(a.materialesReservados).toBe(false);
      expect(repo.save).toHaveBeenCalledWith(a);
    });
  });
});
