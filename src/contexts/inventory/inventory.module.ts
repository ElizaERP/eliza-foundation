import { Module } from '@nestjs/common';

import { CatalogContextModule } from '@eliza/contexts/catalog/catalog.module';

import {
  EXISTENCIA_REPOSITORY,
  LOCATION_REPOSITORY,
  LOTE_REPOSITORY,
  MOVIMIENTO_REPOSITORY,
  WAREHOUSE_REPOSITORY,
} from '@eliza/contexts/inventory/domain';

import {
  AdjustStockUseCase,
  BlockLotUseCase,
  CreateLocationUseCase,
  CreateWarehouseUseCase,
  DispatchInventoryUseCase,
  GetLotByIdUseCase,
  GetMovementHistoryUseCase,
  GetStockBySkuUseCase,
  InventoryExternalEventHandlers,
  ListExpiringLotsUseCase,
  ListLocationsUseCase,
  ListLotsByProductUseCase,
  ListWarehousesUseCase,
  ReceiveInventoryUseCase,
  RegisterLotUseCase,
  RegisterReceiptUseCase,
  ReleaseLotUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
  TransferStockUseCase,
} from '@eliza/contexts/inventory/application';

import { FefoReservationService } from '@eliza/contexts/inventory/infrastructure/services/fefo-reservation.service';
import { PrismaExistenciaRepository } from '@eliza/contexts/inventory/infrastructure/persistence/prisma-existencia.repository';
import { PrismaLoteRepository } from '@eliza/contexts/inventory/infrastructure/persistence/prisma-lote.repository';
import { PrismaMovimientoRepository } from '@eliza/contexts/inventory/infrastructure/persistence/prisma-movimiento.repository';
import {
  PrismaLocationRepository,
  PrismaWarehouseRepository,
} from '@eliza/contexts/inventory/infrastructure/persistence/prisma-warehouse.repository';

import { LotsController } from '@eliza/contexts/inventory/interface/http/lots.controller';
import { MovementsController } from '@eliza/contexts/inventory/interface/http/movements.controller';
import { StockController } from '@eliza/contexts/inventory/interface/http/stock.controller';
import { WarehousesController } from '@eliza/contexts/inventory/interface/http/warehouses.controller';

@Module({
  imports: [CatalogContextModule],
  controllers: [LotsController, StockController, MovementsController, WarehousesController],
  providers: [
    { provide: LOTE_REPOSITORY, useClass: PrismaLoteRepository },
    { provide: EXISTENCIA_REPOSITORY, useClass: PrismaExistenciaRepository },
    { provide: MOVIMIENTO_REPOSITORY, useClass: PrismaMovimientoRepository },
    { provide: WAREHOUSE_REPOSITORY, useClass: PrismaWarehouseRepository },
    { provide: LOCATION_REPOSITORY, useClass: PrismaLocationRepository },
    FefoReservationService,
    RegisterLotUseCase, BlockLotUseCase, ReleaseLotUseCase,
    GetLotByIdUseCase, ListExpiringLotsUseCase, ListLotsByProductUseCase,
    ReceiveInventoryUseCase, ReserveStockUseCase, ReleaseReservationUseCase,
    AdjustStockUseCase, TransferStockUseCase, DispatchInventoryUseCase, RegisterReceiptUseCase,
    GetStockBySkuUseCase, GetMovementHistoryUseCase,
    CreateWarehouseUseCase, CreateLocationUseCase,
    ListWarehousesUseCase, ListLocationsUseCase,
    InventoryExternalEventHandlers,
  ],
  exports: [
      LOTE_REPOSITORY, EXISTENCIA_REPOSITORY, MOVIMIENTO_REPOSITORY, WAREHOUSE_REPOSITORY, LOCATION_REPOSITORY,
      // Use cases exportados para cross-BC (Manufacturing, Sales, Procurement)
      RegisterLotUseCase, ReceiveInventoryUseCase,
      ReserveStockUseCase, ReleaseReservationUseCase,
      DispatchInventoryUseCase,
    ],
})
// Los handlers externos inicializan solos: NestJS invoca su onModuleInit().
// (Antes se llamaba además a mano en onApplicationBootstrap, lo que lo
// ejecutaba dos veces y, al implementarse, duplicaría las suscripciones.)
export class InventoryContextModule {}
