import { Injectable, Logger } from '@nestjs/common';

/**
 * Stubs de handlers para eventos de otros BCs que eventualmente
 * disparan acciones en Manufacturing.
 *
 * Actualmente solo loggean. Se activan en sprints futuros.
 *
 *   ── policy: BlockOrderOnLotBlocked ──
 *     quality.LotBlocked.v1 → si una OP está EnProceso y usa ese lote
 *     de MP, alertar o pausar la orden
 *
 *   ── policy: AutoCreateOrderOnLowStock ──
 *     inventory.StockBelowMinimum.v1 → si el producto es PT,
 *     sugerir o crear automáticamente una OP de reposición
 *
 *   ── policy: UpdateBomOnProductChanged ──
 *     catalog.ProductUpdated.v1 → NO afecta órdenes existentes
 *     (tienen BOM snapshot inmutable), pero podría notificar
 */
@Injectable()
export class ManufacturingExternalEventHandlers {
  private readonly logger = new Logger(ManufacturingExternalEventHandlers.name);

  constructor() {
    this.logger.log('ManufacturingExternalEventHandlers initialized (stubs only)');
  }

  onModuleInit(): void {
    this.logger.log('External event handler stubs ready — 3 event types will be handled in future sprints');
    this.logger.debug('Future: quality.LotBlocked.v1 → alert/pause orders using that lot');
    this.logger.debug('Future: inventory.StockBelowMinimum.v1 → suggest replenishment order');
    this.logger.debug('Future: catalog.ProductUpdated.v1 → notify (no impact on existing orders)');
  }
}