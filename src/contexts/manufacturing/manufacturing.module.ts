import { Module } from '@nestjs/common';

import { CatalogContextModule } from '@eliza/contexts/catalog/catalog.module';
import { InventoryContextModule } from '@eliza/contexts/inventory/inventory.module';

import { ORDEN_PRODUCCION_REPOSITORY } from '@eliza/contexts/manufacturing/domain';

import {
  CancelProductionOrderUseCase,
  CompleteProductionOrderUseCase,
  CreateProductionOrderUseCase,
  GetProductionOrderByIdUseCase,
  ListProductionOrdersUseCase,
  ManufacturingExternalEventHandlers,
  RecordConsumptionUseCase,
  RecordProductionUseCase,
  ReserveMaterialsUseCase,
  StartProductionUseCase,
} from '@eliza/contexts/manufacturing/application';

import { PrismaOrdenProduccionRepository } from '@eliza/contexts/manufacturing/infrastructure/persistence/prisma-orden-produccion.repository';

import { ProductionOrdersController } from '@eliza/contexts/manufacturing/interface/http/production-orders.controller';

@Module({
  imports: [CatalogContextModule, InventoryContextModule],
  controllers: [ProductionOrdersController],
  providers: [
    { provide: ORDEN_PRODUCCION_REPOSITORY, useClass: PrismaOrdenProduccionRepository },
    CreateProductionOrderUseCase,
    ReserveMaterialsUseCase,
    StartProductionUseCase,
    RecordConsumptionUseCase,
    RecordProductionUseCase,
    CompleteProductionOrderUseCase,
    CancelProductionOrderUseCase,
    GetProductionOrderByIdUseCase,
    ListProductionOrdersUseCase,
    ManufacturingExternalEventHandlers,
  ],
  exports: [ORDEN_PRODUCCION_REPOSITORY],
})
// Los handlers externos inicializan solos: NestJS invoca su onModuleInit().
// (Antes se llamaba además a mano en onApplicationBootstrap, lo que lo
// ejecutaba dos veces y, al implementarse, duplicaría las suscripciones.)
export class ManufacturingContextModule {}