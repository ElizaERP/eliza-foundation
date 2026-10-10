import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';

import { JwtAuthGuard } from '@eliza/contexts/iam/infrastructure/auth/auth.guards';
import { ClockPort, TenantAccess, TenantAccessPort } from '@eliza/shared-kernel/application/ports';
import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';

import { PrismaTenantAccess, TENANT_ACCESS_TTL_MS } from './prisma-tenant-access';

const TENANT = '0192f0a0-0000-7000-8000-000000000001';

/** Prisma falso: devuelve el estado que diga `estado` y cuenta las consultas. */
function prismaFalso(estado: () => string | null) {
  const consultas = { n: 0 };
  const prisma = {
    withTenant: async <T>(work: (tx: unknown) => Promise<T>) =>
      work({
        tenant: {
          findUnique: async () => {
            consultas.n += 1;
            const s = estado();
            return s ? { status: s } : null;
          },
        },
      }),
  } as unknown as PrismaService;
  return { prisma, consultas };
}

function reloj(inicio = 1_000_000) {
  let t = inicio;
  const clock: ClockPort = { now: () => new Date(t), nowIso: () => new Date(t).toISOString() };
  return { clock, avanzar: (ms: number) => (t += ms) };
}

describe('PrismaTenantAccess (estado del tenant para el guard)', () => {
  it.each<[string | null, TenantAccess]>([
    ['Active', 'active'],
    ['Suspended', 'suspended'],
    ['PendingActivation', 'inactive'],
    ['Deleted', 'inactive'],
    [null, 'inactive'],
  ])('estado %s → %s', async (estado, esperado) => {
    const { prisma } = prismaFalso(() => estado);
    expect(await new PrismaTenantAccess(prisma, reloj().clock).check(TENANT)).toBe(esperado);
  });

  it('un tenant_id que no es UUID es inactive sin consultar la base', async () => {
    const { prisma, consultas } = prismaFalso(() => 'Active');
    expect(await new PrismaTenantAccess(prisma, reloj().clock).check("x'; DROP TABLE x;--")).toBe('inactive');
    expect(consultas.n).toBe(0);
  });

  it('recuerda el estado 30 s y luego vuelve a consultar (la suspensión llega en ≤ 30 s)', async () => {
    let estado = 'Active';
    const { prisma, consultas } = prismaFalso(() => estado);
    const r = reloj();
    const access = new PrismaTenantAccess(prisma, r.clock);

    expect(await access.check(TENANT)).toBe('active');
    estado = 'Suspended';
    r.avanzar(TENANT_ACCESS_TTL_MS - 1);
    expect(await access.check(TENANT)).toBe('active'); // aún en caché
    expect(consultas.n).toBe(1);

    r.avanzar(1);
    expect(await access.check(TENANT)).toBe('suspended');
    expect(consultas.n).toBe(2);
  });
});

describe('JwtAuthGuard: tenant que no está Active', () => {
  const guardCon = (access: TenantAccess | null) => {
    const port: TenantAccessPort | undefined = access ? { check: async () => access } : undefined;
    const guard = new JwtAuthGuard(new Reflector(), {} as ClsService, port);
    return (tenantId: string) => guard['exigirTenantActivo'](tenantId);
  };

  it('Active: deja pasar', async () => {
    await expect(guardCon('active')(TENANT)).resolves.toBeUndefined();
  });

  it('Suspended: 403 tenant.suspended', async () => {
    await expect(guardCon('suspended')(TENANT)).rejects.toMatchObject({
      code: 'tenant.suspended',
      category: 'tenant_inactive',
    });
  });

  it('pendiente, eliminado o inexistente: 403 tenant.inactive', async () => {
    await expect(guardCon('inactive')(TENANT)).rejects.toMatchObject({
      code: 'tenant.inactive',
      category: 'tenant_inactive',
    });
  });

  it('sin el port (pruebas aisladas de IAM): no bloquea', async () => {
    await expect(guardCon(null)(TENANT)).resolves.toBeUndefined();
  });
});
