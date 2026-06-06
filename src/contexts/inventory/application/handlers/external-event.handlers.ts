import { Injectable, Logger } from '@nestjs/common';

/**
 * Stubs de handlers para eventos de otros bounded contexts.
 * En este sprint los handlers solo loggean; se activan cuando
 * implementemos los BCs respectivos.
 *
 * El Outbox Dispatcher ya maneja la publicación de eventos.
 * Cuando los BCs de Sales, Manufacturing, etc. existan, estos
 * handlers se registrarán en el dispatcher del Outbox para
 * reaccionar a sus eventos.
 */
@Injectable()
export class InventoryExternalEventHandlers {
  private readonly logger = new Logger(InventoryExternalEventHandlers.name);

  constructor() {
    this.logger.log('InventoryExternalEventHandlers initialized (stubs only)');
    this.logger.log('Future subscriptions: sales.OrderConfirmed.v1, manufacturing.ProductionCompleted.v1, procurement.GoodsReceived.v1, quality.LotReleased.v1, quality.LotBlocked.v1, catalog.ProductDiscontinued.v1');
  }

  /**
   * Called by module init. Currently no-op since the event bus is handled
   * by the OutboxDispatcher. When we extract microservices, these handlers
   * will subscribe to the external event bus (Kafka/RabbitMQ).
   */
  onModuleInit(): void {
    this.logger.log('External event handler stubs ready — 6 event types will be handled in future sprints');
  }
}
