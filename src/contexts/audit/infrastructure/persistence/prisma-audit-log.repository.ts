import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';

import {
  AppendAuditInput,
  AuditAction,
  AuditEntry,
  AuditLogId,
  AuditLogRepository,
  AuditQueryFilter,
  AuditQueryResult,
  VerifyChainInput,
  VerifyChainResult,
} from '../../domain';

/**
 * PrismaAuditLogRepository — append-only con hash chain por tenant.
 *
 * Garantías:
 *   1. Atomicidad: SELECT MAX + INSERT en la misma transacción
 *   2. Serialización por tenant: pg_advisory_xact_lock(hashtext('audit:'||tenantId))
 *      Bloquea inserts concurrentes en el MISMO tenant, pero permite
 *      paralelo entre tenants distintos.
 *   3. No requiere tenant context establecido (usa unsafeWithoutTenant
 *      con motivo explícito): audit es transversal y a veces se ejecuta
 *      en contextos donde el RLS aún no se aplicó (ej: login fallido
 *      antes de resolver tenant).
 *
 * Notar que la columna `chain_index` es BigInt — soporta hasta 2^63
 * entradas por tenant (suficiente para cualquier vida útil).
 */
@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  private readonly logger = new Logger(PrismaAuditLogRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendAuditInput): Promise<AuditEntry> {
    return this.prisma.unsafeWithoutTenant(async (tx) => {
      // 1. Lock por tenant (libera al COMMIT/ROLLBACK)
      // hashtext('audit:'||tenantId) → bigint estable
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext('audit:' || $1))`,
        input.tenantId,
      );

      // 2. Obtener el último chainIndex y hash del tenant
      const last = await tx.auditLog.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: { chainIndex: 'desc' },
        select: { chainIndex: true, hash: true },
      });
      const chainIndex = last ? last.chainIndex + 1n : 0n;
      const previousHash = last?.hash ?? null;

      // 3. Construir la entrada (calcula su propio hash)
      const actionR = AuditAction.create(input.action);
      if (actionR.isErr) {
        throw new Error(`Invalid action: ${actionR.error.message}`);
      }

      const entry = AuditEntry.create({
        tenantId: input.tenantId,
        chainIndex,
        previousHash,
        occurredAt: input.occurredAt,
        userId: input.userId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        action: actionR.value,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      // 4. INSERT atómico
      await tx.auditLog.create({
        data: {
          id: entry.id.value,
          tenantId: entry.tenantId,
          chainIndex: entry.chainIndex,
          occurredAt: entry.occurredAt,
          userId: entry.userId,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent ? entry.userAgent.slice(0, 500) : null,
          action: entry.action.value,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: entry.oldValues as Prisma.InputJsonValue,
          newValues: entry.newValues as Prisma.InputJsonValue,
          correlationId: entry.correlationId,
          causationId: entry.causationId,
          previousHash: entry.previousHash,
          hash: entry.hash,
        },
      });

      return entry;
    }, 'AuditLogRepository.append — global audit trail');
  }

  async findById(tenantId: string, auditLogId: string): Promise<AuditEntry | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.auditLog.findFirst({ where: { tenantId, id: auditLogId } }),
      'AuditLogRepository.findById',
    );
    if (!row) return null;
    return this.toDomain(row);
  }

  async query(filter: AuditQueryFilter): Promise<AuditQueryResult> {
    const page = filter.page ?? 1;
    const pageSize = Math.min(filter.pageSize ?? 50, 200);
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = { tenantId: filter.tenantId };
    if (filter.userId) where.userId = filter.userId;
    if (filter.action && filter.action.length > 0) where.action = { in: filter.action };
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.correlationId) where.correlationId = filter.correlationId;
    if (filter.from || filter.to) {
      where.occurredAt = {};
      if (filter.from) where.occurredAt.gte = filter.from;
      if (filter.to) where.occurredAt.lte = filter.to;
    }

    const [rows, total] = await this.prisma.unsafeWithoutTenant(
      (tx) => Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { chainIndex: 'desc' },
          skip,
          take: pageSize,
        }),
        tx.auditLog.count({ where }),
      ]),
      'AuditLogRepository.query',
    );

    return {
      items: rows.map((r) => this.toDomain(r)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async verifyChain(args: VerifyChainInput): Promise<VerifyChainResult> {
    const where: Prisma.AuditLogWhereInput = { tenantId: args.tenantId };
    if (args.fromChainIndex !== undefined) where.chainIndex = { gte: args.fromChainIndex };
    if (args.toChainIndex !== undefined) {
      where.chainIndex = { ...((where.chainIndex as object) ?? {}), lte: args.toChainIndex };
    }

    let entriesChecked = 0;
    let expectedPreviousHash: string | null = null;
    let firstBroken: bigint | null = null;
    let brokenReason: 'hash_mismatch' | 'broken_link' | null = null;

    // Si hay fromChainIndex > 0, necesitamos el hash de la entrada anterior
    if (args.fromChainIndex !== undefined && args.fromChainIndex > 0n) {
      const prev = await this.prisma.unsafeWithoutTenant(
        (tx) => tx.auditLog.findFirst({
          where: { tenantId: args.tenantId, chainIndex: args.fromChainIndex! - 1n },
          select: { hash: true },
        }),
        'verifyChain.bootstrap',
      );
      expectedPreviousHash = prev?.hash ?? null;
    }

    // Paginación interna — evita cargar todo el chain en memoria
    const BATCH = 500;
    let cursor: bigint | undefined =
      args.fromChainIndex !== undefined ? args.fromChainIndex : 0n;

    while (true) {
      const batch = await this.prisma.unsafeWithoutTenant(
        (tx) => tx.auditLog.findMany({
          where: {
            tenantId: args.tenantId,
            chainIndex: {
              gte: cursor!,
              ...(args.toChainIndex !== undefined ? { lte: args.toChainIndex } : {}),
            },
          },
          orderBy: { chainIndex: 'asc' },
          take: BATCH,
        }),
        'verifyChain.batch',
      );
      if (batch.length === 0) break;

      for (const row of batch) {
        entriesChecked += 1;

        // Link consistency
        if (row.previousHash !== expectedPreviousHash) {
          firstBroken = row.chainIndex;
          brokenReason = 'broken_link';
          break;
        }

        // Hash integrity
        const entry = this.toDomain(row);
        if (!entry.verifyHash()) {
          firstBroken = row.chainIndex;
          brokenReason = 'hash_mismatch';
          break;
        }

        expectedPreviousHash = row.hash;
      }

      if (firstBroken !== null) break;
      if (batch.length < BATCH) break;
      cursor = batch[batch.length - 1].chainIndex + 1n;
    }

    return {
      tenantId: args.tenantId,
      entriesChecked,
      isValid: firstBroken === null,
      firstBrokenChainIndex: firstBroken,
      brokenReason,
    };
  }

  // -------- Helpers --------
  private toDomain(row: {
    id: string;
    tenantId: string;
    chainIndex: bigint;
    occurredAt: Date;
    userId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    oldValues: unknown;
    newValues: unknown;
    correlationId: string | null;
    causationId: string | null;
    previousHash: string | null;
    hash: string;
  }): AuditEntry {
    const actionR = AuditAction.create(row.action);
    if (actionR.isErr) {
      throw new Error(`Persisted audit log ${row.id} has invalid action: ${row.action}`);
    }
    return AuditEntry.reconstitute({
      id: AuditLogId.fromString(row.id),
      tenantId: row.tenantId,
      chainIndex: row.chainIndex,
      occurredAt: row.occurredAt,
      userId: row.userId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      action: actionR.value,
      entityType: row.entityType,
      entityId: row.entityId,
      oldValues: row.oldValues,
      newValues: row.newValues,
      correlationId: row.correlationId,
      causationId: row.causationId,
      previousHash: row.previousHash,
      hash: row.hash,
    });
  }
}
