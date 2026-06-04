import { Injectable } from '@nestjs/common';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';

import {
  ProjectionCheckpoint,
  ProjectionCheckpointPort,
} from '../../domain';

@Injectable()
export class PrismaProjectionCheckpoint implements ProjectionCheckpointPort {
  constructor(private readonly prisma: PrismaService) {}

  async getCheckpoint(projectionName: string): Promise<ProjectionCheckpoint | null> {
    const row = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.projectionCheckpoint.findUnique({ where: { projectionName } }),
      'ProjectionCheckpoint.getCheckpoint',
    );
    if (!row) return null;
    return {
      projectionName: row.projectionName,
      lastProcessedEventId: row.lastProcessedEventId,
      lastProcessedAt: row.lastProcessedAt,
      eventsProcessed: row.eventsProcessed,
      lastErrorAt: row.lastErrorAt,
      lastError: row.lastError,
    };
  }

  async recordSuccess(args: { projectionName: string; eventId: string; now: Date }): Promise<void> {
    await this.prisma.unsafeWithoutTenant(
      (tx) => tx.projectionCheckpoint.upsert({
        where: { projectionName: args.projectionName },
        create: {
          projectionName: args.projectionName,
          lastProcessedEventId: args.eventId,
          lastProcessedAt: args.now,
          eventsProcessed: 1n,
        },
        update: {
          lastProcessedEventId: args.eventId,
          lastProcessedAt: args.now,
          eventsProcessed: { increment: 1 },
          lastError: null,
          lastErrorAt: null,
        },
      }),
      'ProjectionCheckpoint.recordSuccess',
    );
  }

  async recordFailure(args: { projectionName: string; error: string; now: Date }): Promise<void> {
    await this.prisma.unsafeWithoutTenant(
      (tx) => tx.projectionCheckpoint.upsert({
        where: { projectionName: args.projectionName },
        create: {
          projectionName: args.projectionName,
          lastErrorAt: args.now,
          lastError: args.error.slice(0, 4000),
        },
        update: {
          lastErrorAt: args.now,
          lastError: args.error.slice(0, 4000),
        },
      }),
      'ProjectionCheckpoint.recordFailure',
    );
  }
}
