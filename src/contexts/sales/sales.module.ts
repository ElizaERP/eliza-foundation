import { Module, OnApplicationBootstrap } from '@nestjs/common';

import { CatalogContextModule } from '@eliza/contexts/catalog/catalog.module';
import { InventoryContextModule } from '@eliza/contexts/inventory/inventory.module';

import {
  CLIENTE_REPOSITORY,
  ORDEN_VENTA_REPOSITORY,
} from '@eliza/contexts/sales/domain';

import {
  ActivateCustomerUseCase,
  AddOrderLineUseCase,
  CancelOrderUseCase,
  CloseOrderUseCase,
  ConfirmOrderUseCase,
  CreateCustomerUseCase,
  CreateSalesOrderUseCase,
  DispatchOrderUseCase,
  GetCustomerByIdUseCase,
  GetSalesOrderByIdUseCase,
  ListCustomersUseCase,
  ListSalesOrdersUseCase,
  RemoveOrderLineUseCase,
  ReserveOrderStockUseCase,
  SalesExternalEventHandlers,
  SuspendCustomerUseCase,
  UpdateCustomerUseCase,
} from '@eliza/contexts/sales/application';

import { PrismaClienteRepository } from '@eliza/contexts/sales/infrastructure/persistence/prisma-cliente.repository';
import { PrismaOrdenVentaRepository } from '@eliza/contexts/sales/infrastructure/persistence/prisma-orden-venta.repository';

import { CustomersController } from '@eliza/contexts/sales/interface/http/customers.controller';
import { SalesOrdersController } from '@eliza/contexts/sales/interface/http/sales-orders.controller';

@Module({
  imports: [CatalogContextModule, InventoryContextModule],
  controllers: [CustomersController, SalesOrdersController],
  providers: [
    // Repositorios
    { provide: CLIENTE_REPOSITORY, useClass: PrismaClienteRepository },
    { provide: ORDEN_VENTA_REPOSITORY, useClass: PrismaOrdenVentaRepository },

    // Customer use cases
    CreateCustomerUseCase,
    UpdateCustomerUseCase,
    SuspendCustomerUseCase,
    ActivateCustomerUseCase,
    GetCustomerByIdUseCase,
    ListCustomersUseCase,

    // Sales order use cases
    CreateSalesOrderUseCase,
    AddOrderLineUseCase,
    RemoveOrderLineUseCase,
    ConfirmOrderUseCase,
    ReserveOrderStockUseCase,
    DispatchOrderUseCase,
    CancelOrderUseCase,
    CloseOrderUseCase,
    GetSalesOrderByIdUseCase,
    ListSalesOrdersUseCase,

    // External event handlers
    SalesExternalEventHandlers,
  ],
  exports: [CLIENTE_REPOSITORY, ORDEN_VENTA_REPOSITORY],
})
export class SalesContextModule implements OnApplicationBootstrap {
  constructor(private readonly externalHandlers: SalesExternalEventHandlers) {}

  onApplicationBootstrap(): void {
    this.externalHandlers.onModuleInit();
  }
}