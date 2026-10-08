import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { CLOCK_PORT, ClockPort } from '@eliza/shared-kernel/application/ports';
import { Prisma } from '@prisma/client';
import { v5 as uuidv5, validate as uuidValidate } from 'uuid';

import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';

import {
  BusMessage,
  EVENT_BUS_PORT,
  EventBusPort,
  PROJECTION_CHECKPOINT_PORT,
  ProjectionCheckpointPort,
} from '../../../outbox/domain';

/**
 * TenantSummaryProjector — materializa `platform.tenant_summary` a partir
 * de los domain events del BC Tenant + cuentas derivadas del BC IAM.
 *
 * Se suscribe a:
 *   tenant.TenantCreated.v1
 *   tenant.TenantActivated.v1
 *   tenant.TenantSuspended.v1
 *   tenant.TenantReactivated.v1
 *   tenant.TenantPlanChanged.v1
 *   tenant.TenantDeleted.v1
 *   iam.MembershipGranted.v1   → ++userCount
 *   iam.MembershipRevoked.v1   → --userCount
 *   iam.UserActivated.v1       → ++activeUserCount
 *   iam.UserSuspended.v1       → --activeUserCount
 *
 * Idempotencia: platform.processed_events (proyección, evento) en la misma
 * transacción que el read model. ProjectionCheckpoint queda solo como
 * métrica (último evento, total procesado, último error).
 *
 * Se ejecuta en el handler del EventBus — funciona tanto con InMemoryEventBus
 * como con RedisStreamsEventBus.
 */
@Injectable()
export class TenantSummaryProjector implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantSummaryProjector.name);
  private static readonly NAME = 'tenant-summary';

  constructor(
    @Inject(EVENT_BUS_PORT) private readonly bus: EventBusPort,
    @Inject(PROJECTION_CHECKPOINT_PORT) private readonly checkpoint: ProjectionCheckpointPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    const handler = this.handle.bind(this);
    this.bus.subscribe('tenant.TenantCreated.v1', handler);
    this.bus.subscribe('tenant.TenantActivated.v1', handler);
    this.bus.subscribe('tenant.TenantSuspended.v1', handler);
    this.bus.subscribe('tenant.TenantReactivated.v1', handler);
    this.bus.subscribe('tenant.TenantPlanChanged.v1', handler);
    this.bus.subscribe('tenant.TenantDeleted.v1', handler);
    this.bus.subscribe('iam.MembershipGranted.v1', handler);
    this.bus.subscribe('iam.MembershipRevoked.v1', handler);
    this.bus.subscribe('iam.UserActivated.v1', handler);
    this.bus.subscribe('iam.UserSuspended.v1', handler);
    this.logger.log('TenantSummaryProjector subscribed to 10 event types');
  }

  /**
   * Clave de idempotencia como UUID (processed_events.event_id y el checkpoint
   * son columnas uuid). Los eventos nuevos traen eventId UUID v7; los antiguos
   * traian un ULID, que se convierte de forma determinista con UUID v5 para que
   * el mismo evento produzca siempre la misma clave.
   */
  private static dedupKey(eventId: string): string {
    return uuidValidate(eventId) ? eventId : uuidv5(eventId, TenantSummaryProjector.LEGACY_ID_NAMESPACE);
  }

  private static readonly LEGACY_ID_NAMESPACE = '6f1a1c3e-2b0d-4c8e-9a51-3d7e0b2f9c41';

  private async handle(message: BusMessage): Promise<void> {
    const eventKey = TenantSummaryProjector.dedupKey(message.id);
    try {
      // Idempotencia real: registrar el evento y aplicar el cambio en UNA
      // transacción. Si (proyección, evento) ya existe, no se toca el read
      // model. Cubre reentregas fuera de orden (reclaimStuck, reintentos),
      // no solo la repetición del último evento.
      const applied = await this.prisma.unsafeWithoutTenant(async (tx) => {
        const inserted = await tx.$executeRaw`
          INSERT INTO platform.processed_events (projection_name, event_id)
          VALUES (${TenantSummaryProjector.NAME}, ${eventKey}::uuid)
          ON CONFLICT DO NOTHING`;
        if (inserted === 0) return false;
        await this.applyEvent(tx, message);
        return true;
      }, `TenantSummary projection — ${message.type}`);

      if (!applied) {
        this.logger.debug(`Skipping already-processed event ${message.id}`);
        return;
      }

      await this.checkpoint.recordSuccess({
        projectionName: TenantSummaryProjector.NAME,
        eventId: eventKey,
        now: this.clock.now(),
      });
    } catch (e) {
      await this.checkpoint.recordFailure({
        projectionName: TenantSummaryProjector.NAME,
        error: (e as Error).message,
        now: this.clock.now(),
      });
      throw e; // re-lanza para que el bus aplique retry
    }
  }

  private async applyEvent(tx: Prisma.TransactionClient, message: BusMessage): Promise<void> {
    const tenantId = message.tenantId;
    const occurredAt = new Date(message.occurredAt);

    switch (message.type) {
      case 'tenant.TenantCreated.v1': {
        const p = message.payload as { code: string; name: string; status: string; plan: string };
        await tx.tenantSummary.upsert({
            where: { tenantId },
            create: {
              tenantId,
              code: p.code,
              name: p.name,
              status: p.status,
              plan: p.plan,
              userCount: 0,
              activeUserCount: 0,
              lastEventAt: occurredAt,
              lastEventType: message.type,
            },
            update: {
              code: p.code,
              name: p.name,
              status: p.status,
              plan: p.plan,
              lastEventAt: occurredAt,
              lastEventType: message.type,
            },
          });
        break;
      }

      case 'tenant.TenantActivated.v1':
      case 'tenant.TenantReactivated.v1':
        await this.updateStatus(tx, tenantId, 'Active', message.type, occurredAt);
        break;

      case 'tenant.TenantSuspended.v1':
        await this.updateStatus(tx, tenantId, 'Suspended', message.type, occurredAt);
        break;

      case 'tenant.TenantDeleted.v1':
        await this.updateStatus(tx, tenantId, 'Deleted', message.type, occurredAt);
        break;

      case 'tenant.TenantPlanChanged.v1': {
        const p = message.payload as { newPlan: string };
        await tx.tenantSummary.update({
            where: { tenantId },
            data: { plan: p.newPlan, lastEventAt: occurredAt, lastEventType: message.type },
          });
        break;
      }

      case 'iam.MembershipGranted.v1':
        await this.incrementCount(tx, tenantId, 'userCount', 1, message.type, occurredAt);
        break;

      case 'iam.MembershipRevoked.v1':
        await this.incrementCount(tx, tenantId, 'userCount', -1, message.type, occurredAt);
        break;

      case 'iam.UserActivated.v1':
        await this.incrementCount(tx, tenantId, 'activeUserCount', 1, message.type, occurredAt);
        break;

      case 'iam.UserSuspended.v1':
        await this.incrementCount(tx, tenantId, 'activeUserCount', -1, message.type, occurredAt);
        break;

      default:
        this.logger.debug(`Unhandled event type: ${message.type}`);
    }
  }

  private async updateStatus(tx: Prisma.TransactionClient, tenantId: string, status: string, eventType: string, occurredAt: Date): Promise<void> {
    await tx.tenantSummary.updateMany({
        where: { tenantId },
        data: { status, lastEventAt: occurredAt, lastEventType: eventType },
      });
  }

  private async incrementCount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    field: 'userCount' | 'activeUserCount',
    delta: number,
    eventType: string,
    occurredAt: Date,
  ): Promise<void> {
    await tx.tenantSummary.update({
        where: { tenantId },
        data: {
          [field]: { increment: delta },
          lastEventAt: occurredAt,
          lastEventType: eventType,
        },
      });
  }
}
