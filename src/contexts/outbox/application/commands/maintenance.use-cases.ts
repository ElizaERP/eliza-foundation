import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK_PORT, ClockPort } from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  OUTBOX_REPOSITORY,
  OutboxRepositoryPort,
} from '../../domain';

// =====================================================================
// ReplayEvent — reagenda un evento (cualquier estado) como Pending
// =====================================================================
@Injectable()
export class ReplayEvent implements UseCase<{ eventId: string }, { eventId: string; status: string }> {
  private readonly logger = new Logger(ReplayEvent.name);

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repo: OutboxRepositoryPort,
  ) {}

  async execute(input: { eventId: string }) {
    const entry = await this.repo.findById(input.eventId);
    if (!entry) {
      return err(applicationError(
        'outbox.event_not_found',
        `Outbox event '${input.eventId}' not found`,
        'not_found',
      ));
    }
    await this.repo.replay(input.eventId);
    this.logger.log(`Event ${input.eventId} (${entry.eventType}) replayed`);
    return ok<{ eventId: string; status: string }, ApplicationError>({
      eventId: input.eventId,
      status: 'Pending',
    });
  }
}

// =====================================================================
// ReclaimStuckEvents — re-encola eventos cuyo Processing lease expiró
// =====================================================================
@Injectable()
export class ReclaimStuckEvents implements UseCase<{ staleAfterMs: number }, { reclaimed: number }> {
  private readonly logger = new Logger(ReclaimStuckEvents.name);

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repo: OutboxRepositoryPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { staleAfterMs: number }) {
    const reclaimed = await this.repo.reclaimStuck(input.staleAfterMs);
    if (reclaimed > 0) {
      this.logger.warn(`Reclaimed ${reclaimed} stuck Processing events`);
    }
    return ok<{ reclaimed: number }, ApplicationError>({ reclaimed });
  }
}
