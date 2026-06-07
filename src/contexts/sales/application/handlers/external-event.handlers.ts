import { Injectable, Logger } from '@nestjs/common';

/**
 * Stubs de handlers para eventos de otros BCs que eventualmente
 * disparan acciones en Sales.
 *
 *   ── policy: NotifyCustomerOnDispatch ──
 *     inventory.InventoryDispatched.v1 → notificar al cliente
 *
 *   ── policy: BlockOrdersOnLotBlocked ──
 *     quality.LotBlocked.v1 → si hay pedidos reservados con ese lote,
 *     alertar o pausar despacho
 *
 *   ── policy: UpdatePricingOnProductChanged ──
 *     catalog.ProductUpdated.v1 → NO afecta pedidos existentes
 *     (tienen precio snapshot), pero podría notificar
 */
@Injectable()
export class SalesExternalEventHandlers {
  private readonly logger = new Logger(SalesExternalEventHandlers.name);

  constructor() {
    this.logger.log('SalesExternalEventHandlers initialized (stubs only)');
  }

  onModuleInit(): void {
    this.logger.log('External event handler stubs ready — 3 event types will be handled in future sprints');
    this.logger.debug('Future: inventory.InventoryDispatched.v1 → notify customer');
    this.logger.debug('Future: quality.LotBlocked.v1 → alert on reserved orders');
    this.logger.debug('Future: catalog.ProductUpdated.v1 → notify (no impact on existing orders)');
  }
}