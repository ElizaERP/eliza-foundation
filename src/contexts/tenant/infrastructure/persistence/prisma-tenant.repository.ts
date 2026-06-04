import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { DomainEvent } from '@eliza/shared-kernel/domain';

import {
  Tenant,
  TenantCode,
  TenantErrors,
  TenantId,
  TenantListOptions,
  TenantListResult,
  TenantRepository,
  TenantStatus,
} from '../../domain';
import { TenantMapper } from './tenant.mapper';

/**
 * Adapter Prisma del TenantRepository.
 *
 * Decisiones clave:
 *   - Tenant Management opera ABOVE tenants → uso `unsafeWithoutTenant`
 *     explícito con justificación. No hay RLS para la tabla tenants.
 *   - El save() persiste el agregado Y sus eventos en outbox en la misma
 *     transacción atómica (Outbox Pattern).
 *   - Optimistic concurrency: el UPDATE incluye `version` en el WHERE.
 *     Si la fila no se actualiza (count = 0), otro request modificó el
 *     agregado entre el read y el write → lanza error de concurrencia.
 *   - findById/findByCode excluyen tenants Deleted por defecto.
 */
@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  private readonly logger = new Logger(PrismaTenantRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: TenantId): Promise<Tenant | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.tenant.findUnique({ where: { id: id.value } }),
      'TenantRepository.findById — Tenant Management opera above tenants',
    );
    if (!row || row.status === 'Deleted') return null;
    return TenantMapper.toDomain(row);
  }

  async findByCode(code: TenantCode): Promise<Tenant | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.tenant.findUnique({ where: { code: code.value } }),
      'TenantRepository.findByCode — Tenant Management opera above tenants',
    );
    if (!row || row.status === 'Deleted') return null;
    return TenantMapper.toDomain(row);
  }

  async existsByCode(code: TenantCode): Promise<boolean> {
    const count = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.tenant.count({
        where: { code: code.value, status: { not: 'Deleted' } },
      }),
      'TenantRepository.existsByCode — uniqueness check across all tenants',
    );
    return count > 0;
  }

  async save(tenant: Tenant): Promise<void> {
    const data = TenantMapper.toPersistence(tenant);
    const events = tenant.pullDomainEvents();

    await this.prisma.unsafeWithoutTenant(async (tx) => {
      if (tenant.version === 1) {
        // Nueva creación
        await tx.tenant.create({ data });
      } else {
        // Update con optimistic concurrency
        const expectedVersion = tenant.version - 1;
        const updated = await tx.tenant.updateMany({
          where: { id: data.id, version: expectedVersion },
          data: {
            code: data.code,
            name: data.name,
            status: data.status,
            plan: data.plan,
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
            deletedAt: data.deletedAt,
            deletedBy: data.deletedBy,
            version: data.version,
          },
        });
        if (updated.count === 0) {
          // Lee la fila para reportar la versión actual
          const current = await tx.tenant.findUnique({ where: { id: data.id } });
          if (!current) {
            throw new Error(`Tenant ${data.id} disappeared during save`);
          }
          const e = TenantErrors.versionMismatch(expectedVersion, current.version);
          throw Object.assign(new Error(e.message), {
            code: e.code,
            category: 'concurrency',
            details: e.details,
          });
        }
      }

      // Outbox — atómico con la escritura del agregado
      if (events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((event) => this.toOutboxRow(event)),
        });
        this.logger.debug(
          `Persisted ${events.length} events to outbox for tenant ${tenant.id.value}`,
        );
      }
    }, 'TenantRepository.save — atomic write with outbox');
  }

  async list(opts: TenantListOptions): Promise<TenantListResult> {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.TenantWhereInput = {};
    if (opts.status && opts.status.length > 0) {
      where.status = { in: opts.status as unknown as Prisma.EnumTenantStatusFilter['in'] };
    } else if (!opts.includeDeleted) {
      where.status = { not: 'Deleted' };
    }

    if (opts.search) {
      where.OR = [
        { code: { contains: opts.search.toLowerCase(), mode: 'insensitive' } },
        { name: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await this.prisma.unsafeWithoutTenant(
      (tx) =>
        Promise.all([
          tx.tenant.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
          }),
          tx.tenant.count({ where }),
        ]),
      'TenantRepository.list — Platform Admin lists all tenants',
    );

    return {
      items: rows.map((r) => TenantMapper.toDomain(r)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // -------- Helpers --------
  private toOutboxRow(event: DomainEvent): Prisma.OutboxEventCreateManyInput {
    const m = event.metadata;
    return {
      id: uuidv4(),
      tenantId: m.tenantId,
      aggregateType: m.aggregateType,
      aggregateId: m.aggregateId,
      eventType: m.eventType,
      eventVersion: m.eventVersion,
      payload: event.payload() as Prisma.InputJsonValue,
      metadata: {
        eventId: m.eventId,
        occurredAt: m.occurredAt.toISOString(),
        correlationId: m.correlationId,
        causationId: m.causationId,
        userId: m.userId,
      } as Prisma.InputJsonValue,
      status: OutboxStatus.Pending,
      occurredAt: m.occurredAt,
      retryCount: 0,
    };
  }
}
