import { err, ok } from '@eliza/shared-kernel/domain';
import { CondicionesPago, EstadoOrdenVenta, OrdenDeVenta } from '@eliza/contexts/sales/domain';

import { ReserveOrderStockUseCase } from './orden-venta.use-cases';

/**
 * Sprint 11: reservar un pedido es todo o nada. Si una línea no alcanza, se
 * deshacen las reservas de las líneas anteriores y el pedido sigue Confirmado.
 */
describe('ReserveOrderStockUseCase — todo o nada', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const tenantId = '01a11e8a-0000-7004-80c9-000000000001';
  const P1 = '01a11e8a-0000-7004-80c9-0000000000a1';
  const P2 = '01a11e8a-0000-7004-80c9-0000000000a2';

  function pedidoConfirmado(): OrdenDeVenta {
    const o = OrdenDeVenta.create({
      tenantId, codigo: 'PV-QA-RES-01', clienteId: '01a11e8a-0000-7004-80c9-000000000004',
      clienteCodigo: 'CLI-QA-001', clienteRazonSocial: 'Cliente QA S.A.S.',
      condicionesPago: CondicionesPago.Contado,
      direccionEntrega: { direccion: 'Calle 10 # 20-30', ciudad: 'Bogota', departamento: 'Cundinamarca' },
      now,
    }).unwrap();
    o.addLine({ productId: P1, productCode: 'QA-AREPA', productName: 'Arepa QA', cantidad: 10, precioUnitario: 4500, tasaIva: 19, now }).unwrap();
    o.addLine({ productId: P2, productCode: 'QA-QUESO', productName: 'Queso QA', cantidad: 5, precioUnitario: 9000, tasaIva: 19, now }).unwrap();
    o.confirm({ now }).unwrap();
    return o;
  }

  function setup(reservaP2: 'ok' | 'sin_stock') {
    const orden = pedidoConfirmado();
    const repo = { findById: jest.fn().mockResolvedValue(orden), save: jest.fn().mockResolvedValue(undefined) };
    const reserveStock = {
      execute: jest.fn().mockImplementation(async ({ productId, cantidad }: { productId: string; cantidad: number }) =>
        productId === P2 && reservaP2 === 'sin_stock'
          ? err({ code: 'inventory.insufficient_stock', message: 'Insufficient stock', category: 'conflict' })
          : ok({ totalAsignado: cantidad, asignaciones: [], reservaIds: [`res-${productId}`] }),
      ),
    };
    const releaseReservation = {
      execute: jest.fn().mockResolvedValue(err({ code: 'inventory.no_reservations_found', message: '', category: 'not_found' })),
    };
    const clock = { now: () => now, nowIso: () => now.toISOString() };
    const useCase = new ReserveOrderStockUseCase(repo as never, reserveStock as never, releaseReservation as never, clock as never);
    return { useCase, orden, repo, reserveStock, releaseReservation };
  }

  const liberados = (release: { execute: jest.Mock }) =>
    release.execute.mock.calls.map(([a]) => (a as { productId: string; reason: string }));

  it('con stock para todo: reserva las 2 líneas y el pedido pasa a Reservada', async () => {
    const { useCase, orden, repo } = setup('ok');
    const r = await useCase.execute({ ordenId: orden.id.value });
    expect(r.unwrap().lineasReservadas).toBe(2);
    expect(orden.estado).toBe(EstadoOrdenVenta.Reservada);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('antes de reservar libera reservas huérfanas de un intento anterior (reintentar no duplica)', async () => {
    const { useCase, orden, releaseReservation, reserveStock } = setup('ok');
    await useCase.execute({ ordenId: orden.id.value });
    const limpieza = liberados(releaseReservation).filter((c) => c.reason.includes('limpieza'));
    expect(limpieza.map((c) => c.productId).sort()).toEqual([P1, P2].sort());
    // la limpieza ocurre antes de la primera reserva
    expect(releaseReservation.execute.mock.invocationCallOrder[0]).toBeLessThan(reserveStock.execute.mock.invocationCallOrder[0]!);
  });

  it('si la 2a línea no alcanza: deshace la 1a, el pedido sigue Confirmado y responde sales.insufficient_stock', async () => {
    const { useCase, orden, repo, releaseReservation } = setup('sin_stock');
    const r = await useCase.execute({ ordenId: orden.id.value });

    expect(r.isErr).toBe(true);
    const e = r.unwrapErr();
    expect(e.code).toBe('sales.insufficient_stock');
    expect(e.category).toBe('conflict');
    expect(e.message).toContain('Queso QA');
    expect(e.details).toMatchObject({ productCode: 'QA-QUESO', cantidad: 5 });

    const compensacion = liberados(releaseReservation).filter((c) => c.reason.includes('se deshace'));
    expect(compensacion.map((c) => c.productId)).toEqual([P1]);
    expect(orden.estado).toBe(EstadoOrdenVenta.Confirmada);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('un pedido que no está Confirmado no se reserva', async () => {
    const { useCase, orden, reserveStock } = setup('ok');
    await useCase.execute({ ordenId: orden.id.value }); // queda Reservada
    const r = await useCase.execute({ ordenId: orden.id.value });
    expect(r.unwrapErr().code).toBe('sales.must_be_confirmed');
    expect(reserveStock.execute).toHaveBeenCalledTimes(2); // solo las del primer intento
  });
});
