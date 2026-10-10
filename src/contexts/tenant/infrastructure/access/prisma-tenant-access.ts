import { Inject, Injectable } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
  TenantAccess,
  TenantAccessPort,
} from '@eliza/shared-kernel/application/ports';
import { Identifier } from '@eliza/shared-kernel/domain';
import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';

/** Cuánto se recuerda el estado de un tenant antes de volver a consultarlo. */
export const TENANT_ACCESS_TTL_MS = 30_000;
/** Tope de tenants en memoria (protege la RAM ante tokens con tenant_id raros). */
const MAX_ENTRIES = 1_000;

interface Entry {
  access: TenantAccess;
  expiresAt: number;
}

/**
 * Estado de acceso del tenant para el JwtAuthGuard (hallazgo crítico
 * "Multi-tenancy" de la Fase 0: un tenant suspendido seguía operando).
 *
 * Se consulta en cada request autenticado, así que el resultado se guarda
 * TENANT_ACCESS_TTL_MS en memoria: una suspensión tarda como máximo 30 s
 * en surtir efecto en cada proceso de la API, y la base recibe a lo sumo
 * dos consultas por minuto por tenant.
 *
 * La lectura usa withTenant (el guard ya fijó el tenant verificado en el
 * contexto): respeta RLS y no pasa por unsafeWithoutTenant, que escribiría
 * una advertencia en el log en cada consulta.
 */
@Injectable()
export class PrismaTenantAccess implements TenantAccessPort {
  private readonly cache = new Map<string, Entry>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async check(tenantId: string): Promise<TenantAccess> {
    // Un tenant_id que no es UUID no existe: no vale la pena ir a la base.
    if (!Identifier.isValidUuid(tenantId)) return 'inactive';

    const now = this.clock.now().getTime();
    const hit = this.cache.get(tenantId);
    if (hit && hit.expiresAt > now) return hit.access;

    const row: { status: string } | null = await this.prisma.withTenant((tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } }),
    );
    const access: TenantAccess =
      row?.status === 'Active' ? 'active' : row?.status === 'Suspended' ? 'suspended' : 'inactive';

    if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(tenantId, { access, expiresAt: now + TENANT_ACCESS_TTL_MS });
    return access;
  }
}
