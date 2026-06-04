import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DispatchOutboxBatch,
  GetOutboxStats,
  ListDeadLetter,
  QueryOutbox,
  ReclaimStuckEvents,
  ReplayEvent,
} from './application';
import {
  EVENT_BUS_PORT,
  OUTBOX_REPOSITORY,
  PROJECTION_CHECKPOINT_PORT,
} from './domain';
import {
  InMemoryEventBus,
  RedisStreamsEventBus,
} from './infrastructure/bus/event-buses';
import { OutboxDispatcher } from './infrastructure/dispatcher/outbox.dispatcher';
import { PrismaOutboxRepository } from './infrastructure/persistence/prisma-outbox.repository';
import { PrismaProjectionCheckpoint } from './infrastructure/persistence/prisma-projection-checkpoint';
import { TenantSummaryProjector } from './infrastructure/subscribers/tenant-summary.projector';
import {
  PlatformOutboxController,
  PlatformReadModelsController,
} from './interface/http/outbox.controllers';

/**
 * Factory del EventBus — decide la implementación según env var.
 *
 *   EVENT_BUS_TYPE=in_memory     → desarrollo, tests, single-pod
 *   EVENT_BUS_TYPE=redis_streams → producción, multi-pod
 *
 * El bus se inyecta como singleton vía el token EVENT_BUS_PORT, así
 * que los subscribers/proyectores no saben qué implementación están usando.
 */
const eventBusProvider: Provider = {
  provide: EVENT_BUS_PORT,
  useFactory: (config: ConfigService) => {
    const type = config.get<string>('EVENT_BUS_TYPE', 'in_memory');
    if (type === 'redis_streams') {
      return new RedisStreamsEventBus(config);
    }
    return new InMemoryEventBus();
  },
  inject: [ConfigService],
};

const adapters: Provider[] = [
  PrismaOutboxRepository,
  { provide: OUTBOX_REPOSITORY, useExisting: PrismaOutboxRepository },

  PrismaProjectionCheckpoint,
  { provide: PROJECTION_CHECKPOINT_PORT, useExisting: PrismaProjectionCheckpoint },

  eventBusProvider,
];

const useCases: Provider[] = [
  DispatchOutboxBatch,
  ReplayEvent,
  ReclaimStuckEvents,
  GetOutboxStats,
  QueryOutbox,
  ListDeadLetter,
];

const subscribers: Provider[] = [
  TenantSummaryProjector,
];

const workers: Provider[] = [
  OutboxDispatcher,
];

@Module({
  controllers: [PlatformOutboxController, PlatformReadModelsController],
  providers: [
    ...adapters,
    ...useCases,
    ...subscribers,
    ...workers,
  ],
  exports: [
    EVENT_BUS_PORT,
    OUTBOX_REPOSITORY,
    PROJECTION_CHECKPOINT_PORT,
  ],
})
export class OutboxContextModule {}
