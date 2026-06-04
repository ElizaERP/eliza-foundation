import { Injectable, Logger, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import {
  BusMessage,
  EventBusPort,
  EventHandler,
} from '../../domain';

const WILDCARD = '*';

/**
 * InMemoryEventBus — implementación sincrónica para desarrollo local
 * y para tests. NO sobrevive a reinicios y NO se distribuye entre pods.
 *
 * Cuando hay múltiples pods en producción, usar RedisStreamsEventBus.
 */
@Injectable()
export class InMemoryEventBus implements EventBusPort {
  private readonly logger = new Logger(InMemoryEventBus.name);
  private readonly handlers = new Map<string, EventHandler[]>();

  async publish(messages: BusMessage[]): Promise<void> {
    for (const message of messages) {
      const specific = this.handlers.get(message.type) ?? [];
      const all = this.handlers.get(WILDCARD) ?? [];
      const handlers = [...specific, ...all];

      // Ejecuta handlers en paralelo. Si UN handler falla, el resto sigue;
      // pero PUBLISH falla en agregado para que el dispatcher reintente.
      const results = await Promise.allSettled(handlers.map((h) => h(message)));
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        const reasons = failures.map((f) => (f as PromiseRejectedResult).reason as Error);
        throw new Error(
          `${failures.length}/${handlers.length} handlers failed for ${message.type}: ` +
          reasons.map((r) => r.message).join('; '),
        );
      }
    }
  }

  subscribe(eventType: string, handler: EventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
    this.logger.debug(`Subscribed handler to ${eventType}`);
  }

  subscribeAll(handler: EventHandler): void {
    this.subscribe(WILDCARD, handler);
  }
}

/**
 * RedisStreamsEventBus — distribución vía Redis Streams.
 *
 * Cada eventType se publica en su propio stream `eliza:event:<type>`.
 * Los handlers leen via consumer groups (XREADGROUP) — patrón at-least-once,
 * sobreviviendo a reinicios.
 *
 * NOTA: el subscriber loop arranca en background. Si por config el
 * EVENT_BUS_TYPE=redis_streams, también se materializa este bus para
 * registrar subscribers; pero la lectura solo ocurre si OUTBOX_SUBSCRIBER_ENABLED.
 */
@Injectable()
export class RedisStreamsEventBus implements EventBusPort, OnModuleDestroy {
  private readonly logger = new Logger(RedisStreamsEventBus.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly streamPrefix: string;
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly consumerGroup: string;
  private readonly consumerName: string;
  private running = false;
  private readLoopPromise: Promise<void> | null = null;

  constructor(config: ConfigService) {
    const redisOpts = {
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: Number(config.get<number>('REDIS_PORT', 6379)),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(config.get<number>('REDIS_DB', 0)),
    };
    this.publisher = new Redis(redisOpts);
    this.subscriber = new Redis(redisOpts);
    this.streamPrefix = config.get<string>('EVENT_BUS_STREAM_PREFIX', 'eliza:event:');
    this.consumerGroup = config.get<string>('EVENT_BUS_CONSUMER_GROUP', 'eliza-foundation');
    this.consumerName = `${config.get<string>('APP_NAME', 'eliza')}-${process.pid}`;
  }

  async publish(messages: BusMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const pipeline = this.publisher.pipeline();
    for (const m of messages) {
      const stream = `${this.streamPrefix}${m.type}`;
      pipeline.xadd(stream, '*', 'message', JSON.stringify(m));
    }
    const results = await pipeline.exec();
    if (!results) throw new Error('Redis pipeline returned null');
    const errors = results.filter(([err]) => err !== null);
    if (errors.length > 0) {
      throw new Error(`Redis publish errors: ${errors.map(([e]) => (e as Error).message).join('; ')}`);
    }
  }

  subscribe(eventType: string, handler: EventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  subscribeAll(handler: EventHandler): void {
    this.subscribe(WILDCARD, handler);
  }

  /**
   * Inicia el loop de lectura. Lo llama explícitamente quien activa el
   * subscriber (la app decide vía env si este pod consume eventos o solo
   * los emite — útil en k8s para tener pods "writers" y "workers").
   */
  async startReadLoop(eventTypes: string[]): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Crear consumer groups (idempotente)
    for (const type of eventTypes) {
      const stream = `${this.streamPrefix}${type}`;
      try {
        await this.subscriber.xgroup('CREATE', stream, this.consumerGroup, '$', 'MKSTREAM');
      } catch (e) {
        // BUSYGROUP = ya existe, OK
        if (!(e as Error).message.includes('BUSYGROUP')) {
          this.logger.warn(`xgroup CREATE on ${stream} failed: ${(e as Error).message}`);
        }
      }
    }

    this.readLoopPromise = this.readLoop(eventTypes);
  }

  private async readLoop(eventTypes: string[]): Promise<void> {
    while (this.running) {
      try {
        const streams = eventTypes.flatMap((t) => [`${this.streamPrefix}${t}`, '>']);
        // XREADGROUP bloqueante de hasta 5s
        const result = (await this.subscriber.xreadgroup(
          'GROUP', this.consumerGroup, this.consumerName,
          'COUNT', 10,
          'BLOCK', 5_000,
          'STREAMS', ...streams,
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!result) continue;

        for (const [stream, entries] of result) {
          const eventType = stream.replace(this.streamPrefix, '');
          for (const [entryId, fields] of entries) {
            const messageRaw = fields[fields.indexOf('message') + 1];
            const message = JSON.parse(messageRaw) as BusMessage;

            const specific = this.handlers.get(eventType) ?? [];
            const all = this.handlers.get(WILDCARD) ?? [];
            try {
              for (const h of [...specific, ...all]) {
                await h(message);
              }
              await this.subscriber.xack(stream, this.consumerGroup, entryId);
            } catch (handlerError) {
              this.logger.error(
                `Handler failure for ${eventType}/${entryId}: ${(handlerError as Error).message}`,
              );
              // No XACK → el evento queda pending y se reintentará
            }
          }
        }
      } catch (e) {
        this.logger.error(`Read loop error: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.readLoopPromise) {
      // Best-effort: dar tiempo a terminar el ciclo actual
      await Promise.race([this.readLoopPromise, new Promise((r) => setTimeout(r, 6_000))]);
    }
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}
