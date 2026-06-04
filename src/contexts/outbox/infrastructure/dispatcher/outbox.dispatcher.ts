import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'node:os';

import {
  DispatchOutboxBatch,
  ReclaimStuckEvents,
} from '../../application';

/**
 * OutboxDispatcher — worker que cada N ms invoca DispatchOutboxBatch.
 *
 * Características:
 *   - Self-bootstrapping: arranca en OnApplicationBootstrap si está habilitado
 *   - Self-shutdown: drena el ciclo actual antes de terminar (SIGTERM)
 *   - Reclaim periódico: cada 30s recupera eventos Processing huérfanos
 *   - Flag OUTBOX_DISPATCHER_ENABLED: permite tener pods que solo escriben
 *     en outbox pero no despachan (útil en k8s con un Deployment "writers"
 *     de muchos replicas + un Deployment "worker" de pocos replicas)
 *
 * El nombre del nodo (processingNode) se construye con hostname + pid;
 * en k8s es el nombre del Pod. Útil para debugging — saber qué pod
 * agarró qué evento.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);

  private readonly enabled: boolean;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryBackoffBaseMs: number;
  private readonly stuckLeaseMs: number;
  private readonly reclaimIntervalMs: number;
  private readonly processingNode: string;

  private pollTimer: NodeJS.Timeout | null = null;
  private reclaimTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private shuttingDown = false;

  constructor(
    config: ConfigService,
    private readonly dispatchBatch: DispatchOutboxBatch,
    private readonly reclaimStuck: ReclaimStuckEvents,
  ) {
    this.enabled = config.get<boolean>('OUTBOX_DISPATCHER_ENABLED', true);
    this.batchSize = Number(config.get<number>('OUTBOX_BATCH_SIZE', 50));
    this.pollIntervalMs = Number(config.get<number>('OUTBOX_POLL_INTERVAL_MS', 1000));
    this.maxRetries = Number(config.get<number>('OUTBOX_MAX_RETRIES', 5));
    this.retryBackoffBaseMs = Number(config.get<number>('OUTBOX_RETRY_BACKOFF_BASE_MS', 1000));
    this.stuckLeaseMs = Number(config.get<number>('OUTBOX_STUCK_LEASE_MS', 60_000));
    this.reclaimIntervalMs = Number(config.get<number>('OUTBOX_RECLAIM_INTERVAL_MS', 30_000));

    const hostname = process.env.HOSTNAME ?? os.hostname();
    this.processingNode = `${hostname}-${process.pid}`;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Outbox dispatcher DISABLED (OUTBOX_DISPATCHER_ENABLED=false)');
      return;
    }
    this.logger.log(
      `Outbox dispatcher ENABLED node=${this.processingNode} ` +
      `batch=${this.batchSize} poll=${this.pollIntervalMs}ms maxRetries=${this.maxRetries}`,
    );
    this.scheduleNext();
    this.scheduleReclaim();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.reclaimTimer) clearTimeout(this.reclaimTimer);

    // Esperar hasta 10s a que termine el ciclo actual
    const start = Date.now();
    while (this.inFlight && Date.now() - start < 10_000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.inFlight) {
      this.logger.warn('Outbox dispatcher did not finish in-flight batch within shutdown grace period');
    }
  }

  private scheduleNext(): void {
    if (this.shuttingDown) return;
    this.pollTimer = setTimeout(() => void this.tick(), this.pollIntervalMs);
  }

  private scheduleReclaim(): void {
    if (this.shuttingDown) return;
    this.reclaimTimer = setTimeout(() => void this.reclaimTick(), this.reclaimIntervalMs);
  }

  private async tick(): Promise<void> {
    if (this.shuttingDown || this.inFlight) {
      this.scheduleNext();
      return;
    }
    this.inFlight = true;
    try {
      const result = await this.dispatchBatch.execute({
        batchSize: this.batchSize,
        processingNode: this.processingNode,
        maxRetries: this.maxRetries,
        retryBackoffBaseMs: this.retryBackoffBaseMs,
      });
      if (result.isOk && result.value.leased > 0) {
        const r = result.value;
        this.logger.debug(
          `Dispatched batch: leased=${r.leased} published=${r.published} failed=${r.failed} ` +
          `deadLettered=${r.deadLettered} (${r.durationMs}ms)`,
        );
      } else if (result.isErr) {
        this.logger.error(`Dispatch batch error: ${result.error.message}`);
      }
    } catch (e) {
      this.logger.error(`Dispatch loop crashed: ${(e as Error).message}`);
    } finally {
      this.inFlight = false;
      this.scheduleNext();
    }
  }

  private async reclaimTick(): Promise<void> {
    if (this.shuttingDown) return;
    try {
      const result = await this.reclaimStuck.execute({ staleAfterMs: this.stuckLeaseMs });
      if (result.isOk && result.value.reclaimed > 0) {
        this.logger.warn(`Reclaimed ${result.value.reclaimed} stuck Processing events`);
      }
    } catch (e) {
      this.logger.error(`Reclaim loop error: ${(e as Error).message}`);
    } finally {
      this.scheduleReclaim();
    }
  }
}
