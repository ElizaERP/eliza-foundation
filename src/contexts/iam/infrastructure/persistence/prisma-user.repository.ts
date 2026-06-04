import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { DomainEvent } from '@eliza/shared-kernel/domain';

import {
  EmailAddress,
  KeycloakSubject,
  User,
  UserErrors,
  UserId,
  UserRepository,
} from '../../domain';
import { UserMapper } from './user.mapper';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: UserId): Promise<User | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.user.findUnique({
        where: { id: id.value },
        include: { memberships: true },
      }),
      'UserRepository.findById — IAM is platform-level',
    );
    if (!row || row.status === 'Deleted') return null;
    return UserMapper.toDomain(row);
  }

  async findByEmail(email: EmailAddress): Promise<User | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.user.findUnique({
        where: { email: email.value },
        include: { memberships: true },
      }),
      'UserRepository.findByEmail',
    );
    if (!row || row.status === 'Deleted') return null;
    return UserMapper.toDomain(row);
  }

  async findByKeycloakSubject(sub: KeycloakSubject): Promise<User | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.user.findUnique({
        where: { keycloakSubject: sub.value },
        include: { memberships: true },
      }),
      'UserRepository.findByKeycloakSubject — auth flow',
    );
    if (!row || row.status === 'Deleted') return null;
    return UserMapper.toDomain(row);
  }

  async existsByEmail(email: EmailAddress): Promise<boolean> {
    const count = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.user.count({
        where: { email: email.value, status: { not: 'Deleted' } },
      }),
      'UserRepository.existsByEmail',
    );
    return count > 0;
  }

  async save(user: User): Promise<void> {
    const { user: userData, memberships } = UserMapper.toPersistence(user);
    const events = user.pullDomainEvents();

    await this.prisma.unsafeWithoutTenant(async (tx) => {
      if (user.version === 1) {
        // Create: user + memberships en una sola operación
        await tx.user.create({
          data: {
            ...userData,
            memberships: {
              create: memberships.map((m) => ({
                id: m.id,
                tenantId: m.tenantId,
                isActive: m.isActive,
                rolesJson: m.rolesJson as Prisma.InputJsonValue,
                createdAt: m.createdAt,
                createdBy: m.createdBy,
                updatedAt: m.updatedAt,
                updatedBy: m.updatedBy,
                version: m.version,
              })),
            },
          },
        });
      } else {
        // Update con optimistic concurrency
        const expectedVersion = user.version - 1;
        const updated = await tx.user.updateMany({
          where: { id: userData.id, version: expectedVersion },
          data: {
            email: userData.email,
            fullName: userData.fullName,
            status: userData.status,
            updatedAt: userData.updatedAt,
            updatedBy: userData.updatedBy,
            deletedAt: userData.deletedAt,
            deletedBy: userData.deletedBy,
            version: userData.version,
          },
        });
        if (updated.count === 0) {
          const current = await tx.user.findUnique({ where: { id: userData.id } });
          if (!current) throw new Error(`User ${userData.id} disappeared during save`);
          const e = UserErrors.versionMismatch(expectedVersion, current.version);
          throw Object.assign(new Error(e.message), {
            code: e.code,
            category: 'concurrency',
            details: e.details,
          });
        }

        // Sincronizar memberships: upsert por (userId, tenantId)
        for (const m of memberships) {
          await tx.userTenantMembership.upsert({
            where: { userId_tenantId: { userId: m.userId, tenantId: m.tenantId } },
            create: {
              id: m.id,
              userId: m.userId,
              tenantId: m.tenantId,
              isActive: m.isActive,
              rolesJson: m.rolesJson as Prisma.InputJsonValue,
              createdAt: m.createdAt,
              createdBy: m.createdBy,
              updatedAt: m.updatedAt,
              updatedBy: m.updatedBy,
              version: m.version,
            },
            update: {
              isActive: m.isActive,
              rolesJson: m.rolesJson as Prisma.InputJsonValue,
              updatedAt: m.updatedAt,
              updatedBy: m.updatedBy,
            },
          });
        }
      }

      // Outbox transaccional
      if (events.length > 0) {
        await tx.outboxEvent.createMany({
          data: events.map((event) => this.toOutboxRow(event)),
        });
        this.logger.debug(`Persisted ${events.length} events for user ${user.id.value}`);
      }
    }, 'UserRepository.save — atomic user + memberships + outbox');
  }

  async listByTenant(opts: {
    tenantId: string;
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {
      status: { not: 'Deleted' },
      memberships: {
        some: { tenantId: opts.tenantId, isActive: true },
      },
    };

    if (opts.search) {
      where.OR = [
        { email: { contains: opts.search.toLowerCase(), mode: 'insensitive' } },
        { fullName: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await this.prisma.unsafeWithoutTenant(
      (tx) => Promise.all([
        tx.user.findMany({
          where,
          include: { memberships: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        tx.user.count({ where }),
      ]),
      'UserRepository.listByTenant',
    );

    return {
      items: rows.map((r) => UserMapper.toDomain(r)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

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
