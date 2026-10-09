import { err, ok } from '@eliza/shared-kernel/domain';
import {
  Cantidad,
  Existencia,
  Lote,
  OrigenLote,
  ReferenciaOrigen,
  TipoReferencia,
} from '@eliza/contexts/inventory/domain';

import { AdjustStockUseCase, GetStockBySkuUseCase } from './existencia.use-cases';
import { RegisterReceiptUseCase } from './recepcion.use-cases';

/**
 * Sprint 13 — Inventario desde la app:
 *   - Recibir mercancía crea el lote y lo ingresa en un paso, sin lotes huérfanos.
 *   - Ajuste por conteo físico: el servidor calcula el delta.
 *   - El resumen de stock trae existenciaId y no cuenta como disponible un lote bloqueado.
 */
describe('Inventario — Sprint 13', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const TENANT = '01a11e8a-0000-7004-80c9-000000000001';
  const PRODUCTO = '01a11e8a-0000-7004-80c9-0000000000b1';
  const UBIC = '01a11e8a-0000-7004-80c9-0000000000c1';
  const clock = { now: () => now, nowIso: () => now.toISOString() };
  const ctx = { tryGetTenantId: () => TENANT, tryGetUserId: () => 'u-1' };

  function lote(codigo = 'HAR-001'): Lote {
    return Lote.create({
      tenantId: TENANT, codigoLote: codigo, productId: PRODUCTO,
      fechaProduccion: new Date('2026-10-01T00:00:00Z'), fechaVencimiento: new Date('2027-04-01T00:00:00Z'),
      cantidadInicial: 100, origenTipo: OrigenLote.Manual, now,
    }).unwrap();
  }

  function existencia(l: Lote, cantidad: number, reservado = 0): Existencia {
    const e = Existencia.createEmpty({ tenantId: TENANT, productId: PRODUCTO, loteId: l.id.value, locationId: UBIC, now });
    e.receive({ cantidad: Cantidad.createPositive(cantidad).unwrap(), movimientoId: 'm-in',
      referencia: ReferenciaOrigen.create(TipoReferencia.Manual, 'carga').unwrap(), now }).unwrap();
    if (reservado > 0) {
      e.reserve({ cantidad: Cantidad.createPositive(reservado).unwrap(),
        referencia: ReferenciaOrigen.create(TipoReferencia.SalesOrder, 'PV-1').unwrap(), now }).unwrap();
    }
    return e;
  }

  // -------------------------------------------------------------------
  describe('RecibirMercancía (RegisterReceipt)', () => {
    const base = {
      productId: PRODUCTO, codigoLote: 'HAR-002', cantidad: 250, locationId: UBIC,
      fechaVencimiento: new Date('2027-04-09'), origenTipo: OrigenLote.Purchase as const, documento: ' FAC-10234 ',
    };
    const loteView = { id: 'lote-nuevo', codigoLote: 'HAR-002' };

    function armar(opts: { ubicacion?: { isActive: boolean } | null; lote?: unknown; recibir?: unknown } = {}) {
      const locationRepo = { findById: jest.fn().mockResolvedValue(opts.ubicacion === undefined ? { isActive: true } : opts.ubicacion) };
      const registerLot = { execute: jest.fn().mockResolvedValue(opts.lote ?? ok(loteView)) };
      const receive = { execute: jest.fn().mockResolvedValue(opts.recibir ?? ok({ existencia: { id: 'ex-1' }, movimientoId: 'mov-1' })) };
      const uc = new RegisterReceiptUseCase(registerLot as never, receive as never, locationRepo as never, clock as never, ctx as never);
      return { uc, registerLot, receive };
    }

    it('crea el lote (origen compra, documento como referencia) y lo ingresa en la ubicación', async () => {
      const { uc, registerLot, receive } = armar();
      const r = await uc.execute(base);
      expect(r.unwrap().movimientoId).toBe('mov-1');
      expect(registerLot.execute).toHaveBeenCalledWith(expect.objectContaining({
        codigoLote: 'HAR-002', cantidadInicial: 250, origenTipo: OrigenLote.Purchase, origenRef: 'FAC-10234', fechaProduccion: now,
      }));
      expect(receive.execute).toHaveBeenCalledWith(expect.objectContaining({
        loteId: 'lote-nuevo', locationId: UBIC, cantidad: 250,
        referenciaTipo: TipoReferencia.PurchaseOrder, referenciaId: 'FAC-10234',
      }));
    });

    it('entrada manual: el movimiento queda con referencia Manual', async () => {
      const { uc, receive } = armar();
      await uc.execute({ ...base, origenTipo: OrigenLote.Manual, documento: 'Inventario inicial' });
      expect(receive.execute.mock.calls[0][0].referenciaTipo).toBe(TipoReferencia.Manual);
    });

    it('ubicación inactiva: no crea el lote', async () => {
      const { uc, registerLot } = armar({ ubicacion: { isActive: false } });
      const r = await uc.execute(base);
      expect(r.unwrapErr().code).toBe('inventory.location_inactive');
      expect(registerLot.execute).not.toHaveBeenCalled();
    });

    it('sin documento: no crea nada', async () => {
      const { uc, registerLot } = armar();
      const r = await uc.execute({ ...base, documento: '   ' });
      expect(r.unwrapErr().code).toBe('inventory.receipt_document_required');
      expect(registerLot.execute).not.toHaveBeenCalled();
    });

    it('código de lote repetido: devuelve el 409 de RegisterLot y no ingresa nada', async () => {
      const { uc, receive } = armar({ lote: err({ code: 'inventory.lote_code_exists', message: 'Ya existe', category: 'conflict' }) });
      const r = await uc.execute(base);
      expect(r.unwrapErr().code).toBe('inventory.lote_code_exists');
      expect(receive.execute).not.toHaveBeenCalled();
    });

    it('si el ingreso falla después de crear el lote, el error dice qué lote quedó', async () => {
      const { uc } = armar({ recibir: err({ code: 'inventory.location_inactive', message: 'inactive', category: 'validation' }) });
      const e = (await uc.execute(base)).unwrapErr();
      expect(e.message).toContain('HAR-002');
      expect(e.details).toEqual(expect.objectContaining({ loteId: 'lote-nuevo' }));
    });
  });

  // -------------------------------------------------------------------
  describe('Ajuste por conteo físico', () => {
    function armar(e: Existencia) {
      const existenciaRepo = { findById: jest.fn().mockResolvedValue(e), save: jest.fn() };
      const movimientoRepo = { append: jest.fn() };
      const uc = new AdjustStockUseCase(existenciaRepo as never, movimientoRepo as never, clock as never, ctx as never);
      return { uc, existenciaRepo, movimientoRepo };
    }

    it('contó 45 con 50 en sistema (10 reservados): resta 5 del disponible y deja el conteo en el motivo', async () => {
      const e = existencia(lote(), 50, 10);
      const { uc, movimientoRepo } = armar(e);
      const v = (await uc.execute({ existenciaId: e.id.value, cantidadContada: 45, motivo: 'Conteo cíclico' })).unwrap();
      expect(v.cantidadDisponible).toBe(35);
      expect(v.cantidadReservada).toBe(10);
      const mov = movimientoRepo.append.mock.calls[0][0];
      expect(mov.cantidad.amount ?? mov.cantidad).toBe(5);
      expect(mov.motivo).toBe('Conteo cíclico · conteo 45, sistema 50');
    });

    it('contó más de lo que hay: suma la diferencia', async () => {
      const e = existencia(lote(), 20);
      const v = (await armar(e).uc.execute({ existenciaId: e.id.value, cantidadContada: 23.5, motivo: 'Hallazgo' })).unwrap();
      expect(v.cantidadDisponible).toBe(23.5);
    });

    it('conteo igual al sistema: no ajusta', async () => {
      const e = existencia(lote(), 20);
      const { uc, existenciaRepo } = armar(e);
      const r = await uc.execute({ existenciaId: e.id.value, cantidadContada: 20, motivo: 'Conteo' });
      expect(r.unwrapErr().code).toBe('inventory.count_matches');
      expect(existenciaRepo.save).not.toHaveBeenCalled();
    });

    it('conteo menor que lo reservado: conflicto, hay que liberar primero', async () => {
      const e = existencia(lote(), 50, 30);
      const r = await armar(e).uc.execute({ existenciaId: e.id.value, cantidadContada: 25, motivo: 'Conteo' });
      const er = r.unwrapErr();
      expect(er.code).toBe('inventory.count_below_committed');
      expect(er.category).toBe('conflict');
    });

    it('delta y conteo a la vez (o ninguno): inválido', async () => {
      const e = existencia(lote(), 50);
      const { uc } = armar(e);
      expect((await uc.execute({ existenciaId: e.id.value, delta: -1, cantidadContada: 49, motivo: 'x x' })).unwrapErr().code)
        .toBe('inventory.adjust_input_invalid');
      expect((await uc.execute({ existenciaId: e.id.value, motivo: 'x x' })).unwrapErr().code).toBe('inventory.adjust_input_invalid');
    });

    it('el delta directo sigue funcionando', async () => {
      const e = existencia(lote(), 50);
      const v = (await armar(e).uc.execute({ existenciaId: e.id.value, delta: -2, motivo: 'Merma' })).unwrap();
      expect(v.cantidadDisponible).toBe(48);
    });
  });

  // -------------------------------------------------------------------
  describe('Resumen de stock por producto', () => {
    it('trae existenciaId por ubicación y no cuenta como disponible el lote bloqueado', async () => {
      const bueno = lote('HAR-001');
      const malo = lote('HAR-009');
      malo.block({ reason: 'Muestra con humedad', blockedBy: 'u-1', now }).unwrap();
      const eBueno = existencia(bueno, 40, 5);
      const eMalo = existencia(malo, 15);
      const existenciaRepo = { findBySku: jest.fn().mockResolvedValue([eBueno, eMalo]) };
      const loteRepo = { findById: jest.fn().mockImplementation(async (id: { value: string }) => (id.value === bueno.id.value ? bueno : malo)) };

      const s = (await new GetStockBySkuUseCase(existenciaRepo as never, loteRepo as never, clock as never).execute({ productId: PRODUCTO })).unwrap();

      expect(s.totalDisponible).toBe(35);
      expect(s.totalReservado).toBe(5);
      expect(s.totalBloqueado).toBe(15);
      expect(s.totalFisico).toBe(55);
      const b = s.porLote.find((l) => l.codigoLote === 'HAR-001')!;
      const m = s.porLote.find((l) => l.codigoLote === 'HAR-009')!;
      expect(b.reservable).toBe(true);
      expect(m.reservable).toBe(false);
      expect(b.ubicaciones[0]).toEqual({ existenciaId: eBueno.id.value, locationId: UBIC, cantidadDisponible: 35, cantidadReservada: 5, cantidadBloqueada: 0 });
    });
  });
});
