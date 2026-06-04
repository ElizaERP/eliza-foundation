import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK_PORT, ClockPort } from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  EVENT_BUS_PORT,
  EventBusPort,
  OUTBOX_REPOSITORY,
  OutboxRepositoryPort,
  toBusMessage,
} from '../../domain';

export interface DispatchOutboxBatchInput {
  batchSize: number;
  processingNode: string;
  maxRetries: number;
  /** Backoff base en ms; el retry N esperará base * 2^N. */
  retryBackoffBaseMs: number;
}

export interface DispatchOutboxBatchOutput {
  leased: number;
  published: number;
  failed: number;
  deadLettered: number;
  durationMs: number;
}

/**
 * DispatchOutboxBatch — flujo principal del worker.
 *
 *   1. Leasea N eventos Pending → marca como Processing
 *   2. Para cada uno: bus.publish() → si OK marca Published, si NO Failed
 *   3. Si retryCount excede maxRetries: pasa a DeadLetter
 *
 * Diseño: cada evento se publica/marca INDIVIDUALMENTE. Si uno falla,
 * los demás del batch siguen. Esto es preferible a transacciones grandes
 * que se rompen al primer error.
 *
 * Backoff exponencial: retry 0→1s, 1→2s, 2→4s, 3→8s, 4→16s... Crece
 * hasta MAX 60s para no quedar dormido indefinidamente.
 */
@Injectable()
export class DispatchOutboxBatch
  implements UseCase<DispatchOutboxBatchInput, DispatchOutboxBatchOutput>
{
  private readonly logger = new Logger(DispatchOutboxBatch.name);
  private static readonly MAX_BACKOFF_MS = 60_000;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly repo: OutboxRepositoryPort,
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: DispatchOutboxBatchInput): Promise<Result<DispatchOutboxBatchOutput, ApplicationError>> {
    const start = Date.now();
    let published = 0;
    let failed = 0;
    let deadLettered = 0;

    let entries;
    try {
      entries = await this.repo.leaseNextBatch({
        batchSize: input.batchSize,
        processingNode: input.processingNode,
        now: this.clock.now(),
      });
    } catch (e) {
      return err(applicationError(
        'outbox.lease_failed',
        `Could not lease batch: ${(e as Error).message}`,
        'infrastructure',
      ));
    }

    for (const entry of entries) {
      try {
        await this.bus.publish([toBusMessage(entry)]);
        await this.repo.markPublished(entry.id, this.clock.now());
        published += 1;
      } catch (publishError) {
        const newRetryCount = entry.retryCount + 1;
        const willDeadLetter = newRetryCount >= input.maxRetries;
        const backoffMs = Math.min(
          input.retryBackoffBaseMs * Math.pow(2, newRetryCount - 1),
          DispatchOutboxBatch.MAX_BACKOFF_MS,
        );

        await this.repo.markFailed({
          eventId: entry.id,
          error: this.summarizeError(publishError),
          retryCount: newRetryCount,
          maxRetries: input.maxRetries,
          nextRetryAt: willDeadLetter ? null : new Date(this.clock.now().getTime() + backoffMs),
          now: this.clock.now(),
        });

        if (willDeadLetter) {
          deadLettered += 1;
          this.logger.error(
            `Event ${entry.id} (${entry.eventType}) DEAD-LETTERED after ${newRetryCount} retries: ${this.summarizeError(publishError)}`,
          );
        } else {
          failed += 1;
          this.logger.warn(
            `Event ${entry.id} (${entry.eventType}) failed, retry ${newRetryCount}/${input.maxRetries} scheduled in ${backoffMs}ms`,
          );
        }
      }
    }

    return ok({
      leased: entries.length,
      published,
      failed,
      deadLettered,
      durationMs: Date.now() - start,
    });
  }

  private summarizeError(e: unknown): string {
    const err = e as Error;
    return `${err.name}: ${err.message}`.slice(0, 1000);
  }
}
