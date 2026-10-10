import { ClsService, ClsServiceManager } from 'nestjs-cls';

import { OrdenDeProduccion } from '@eliza/contexts/manufacturing/domain';
import { UnitOfWorkPort } from '@eliza/shared-kernel/application/ports';
import { err, ok } from '@eliza/shared-kernel/domain';
import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';

import { RecordProductionUseCase } from './orden-produccion.use-cases';

/**
 * Fase 0 — hallazgo "Transacciones": registrar producción (crear lote PT,
 * recibir stock y guardar la orden) es UNA transacción. Si un paso falla,
 * no queda nada de los anteriores.
 */
const TENANT = '01a11e8a-0000-7004-80c9-000000000001';
const now = new Date('2026-10-10T12:00:00Z');
const clock = { now: () => now, nowIso: () => now.toISOString() };

/**
 * Base de datos de mentira con transacciones: lo que se escribe dentro de
 * `execute` queda en `pendiente` y solo pasa a `confirmado` si el trabajo
 * termina bien; si lanza, se descarta (rollback).
 */
function bdConTransacciones() {
  const confirmado: string[] = [];
  let pendiente: string[] | null = null;
  const escribir = (que: string) => (pendiente ? pendiente.push(que) : confirmado.push(que));
  const uow: UnitOfWorkPort = {
    async execute<T>(work: () => Promise<T>): Promise<T> {
      pendiente = [];
      try {
        const r = await work();
        confirmado.push(...pendiente);
        return r;
      } finally {
        pendiente = null;
      }
    },
  };
  return { confirmado, escribir, uow };
}

function ordenPlanificada(): OrdenDeProduccion {
  return OrdenDeProduccion.create({
    tenantId: TENANT, codigo: 'OP-QA-ATOM-01',
    productoTerminadoId: '01a11e8a-0000-7004-80c9-0000000000a1', productoTerminadoCode: 'QA-AREPA',
    productoTerminadoName: 'Arepa QA', cantidadObjetivo: 10,
    componentes: [{ productId: '01a11e8a-0000-7004-80c9-0000000000b1', productCode: 'QA-MP-HARINA', productName: 'Harina QA', cantidadPorUnidad: 0.6, cantidadTotalRequerida: 6, unidadMedida: 'kg' }],
    now,
  }).unwrap();
}

function ordenEnProceso(): OrdenDeProduccion {
  const o = ordenPlanificada();
  o.markMaterialsReserved({ now }).unwrap();
  o.start({ iniciadoPor: 'u-1', now }).unwrap();
  return o;
}

describe('RecordProduction atómico', () => {
  const input = (o: OrdenDeProduccion) => ({
    ordenId: o.id.value, codigoLote: 'PT-ATOM-001', cantidad: 10,
    fechaVencimiento: new Date('2026-12-31'), locationId: 'loc-1',
  });

  function armar(opciones: { recepcionFalla?: boolean; guardarFalla?: boolean; orden?: OrdenDeProduccion }) {
    const bd = bdConTransacciones();
    const o = opciones.orden ?? ordenEnProceso();
    const repo = {
      findById: jest.fn().mockResolvedValue(o),
      save: jest.fn().mockImplementation(async () => {
        if (opciones.guardarFalla) throw new Error('version conflict');
        bd.escribir('orden');
      }),
    };
    const registerLot = {
      execute: jest.fn().mockImplementation(async () => {
        bd.escribir('lote');
        return ok({ id: 'L-PT-1' });
      }),
    };
    const receive = {
      execute: jest.fn().mockImplementation(async () => {
        if (opciones.recepcionFalla) {
          return err({ code: 'inventory.location_not_found', message: 'Ubicación no existe', category: 'not_found' });
        }
        bd.escribir('recepcion');
        return ok({ movimientoId: 'M-1' });
      }),
    };
    const uc = new RecordProductionUseCase(repo as never, registerLot as never, receive as never, clock as never, bd.uow);
    return { bd, o, uc, repo, registerLot };
  }

  it('todo bien: lote, recepción y orden quedan confirmados juntos', async () => {
    const { bd, o, uc } = armar({});
    const r = await uc.execute(input(o));
    expect(r.unwrap().cantidadRealProducida).toBe(10);
    expect(bd.confirmado).toEqual(['lote', 'recepcion', 'orden']);
  });

  it('falla la recepción: el lote creado se revierte y responde el error', async () => {
    const { bd, o, uc } = armar({ recepcionFalla: true });
    const r = await uc.execute(input(o));
    expect(r.unwrapErr().code).toBe('manufacturing.receive_failed');
    expect(bd.confirmado).toEqual([]); // antes quedaba un lote huérfano
  });

  it('falla guardar la orden: lote y recepción se revierten (no queda stock sin contar)', async () => {
    const { bd, o, uc } = armar({ guardarFalla: true });
    await expect(uc.execute(input(o))).rejects.toThrow('version conflict');
    expect(bd.confirmado).toEqual([]);
  });

  it('orden que no está en proceso: no toca el inventario', async () => {
    const { bd, uc, repo, registerLot } = armar({ orden: ordenPlanificada() });
    const r = await uc.execute(input(await repo.findById()));
    expect(r.unwrapErr().code).toBe('manufacturing.must_be_en_proceso');
    expect(registerLot.execute).not.toHaveBeenCalled();
    expect(bd.confirmado).toEqual([]);
  });
});

describe('PrismaService.inTransaction (unidad de trabajo real)', () => {
  /** PrismaService sin conectarse: $transaction de mentira que revierte si el trabajo lanza. */
  function prismaDePrueba() {
    const cls = ClsServiceManager.getClsService();
    const transacciones: Array<{ estado: 'abierta' | 'confirmada' | 'revertida' }> = [];
    const svc = Object.create(PrismaService.prototype) as PrismaService;
    Object.assign(svc, {
      cls,
      tenantContext: { getTenantId: () => TENANT, tryGetUserId: () => null, getCorrelationId: () => 'c-1' },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        const t = { estado: 'abierta' as 'abierta' | 'confirmada' | 'revertida' };
        transacciones.push(t);
        const tx = { $executeRawUnsafe: async () => 0, id: transacciones.length };
        try {
          const r = await work(tx);
          t.estado = 'confirmada';
          return r;
        } catch (e) {
          t.estado = 'revertida';
          throw e;
        }
      },
    });
    return { svc, cls: cls as ClsService, transacciones };
  }

  it('los withTenant de adentro (de cualquier contexto) usan la MISMA transacción', async () => {
    const { svc, cls, transacciones } = prismaDePrueba();
    const usadas = await cls.run(() =>
      svc.inTransaction(async () => {
        const a = await svc.withTenant(async (tx) => (tx as unknown as { id: number }).id);
        const b = await svc.withTenant(async (tx) => (tx as unknown as { id: number }).id);
        return [a, b];
      }),
    );
    expect(usadas).toEqual([1, 1]);
    expect(transacciones.map((t) => t.estado)).toEqual(['confirmada']);
  });

  it('si algo lanza adentro, se revierte la transacción entera', async () => {
    const { svc, cls, transacciones } = prismaDePrueba();
    await expect(
      cls.run(() =>
        svc.inTransaction(async () => {
          await svc.withTenant(async () => 'lote');
          throw new Error('falló la recepción');
        }),
      ),
    ).rejects.toThrow('falló la recepción');
    expect(transacciones.map((t) => t.estado)).toEqual(['revertida']);
  });

  it('al terminar, los withTenant siguientes abren su propia transacción', async () => {
    const { svc, cls, transacciones } = prismaDePrueba();
    await cls.run(async () => {
      await svc.inTransaction(async () => svc.withTenant(async () => 1));
      await svc.withTenant(async () => 2);
    });
    expect(transacciones).toHaveLength(2);
  });
});
