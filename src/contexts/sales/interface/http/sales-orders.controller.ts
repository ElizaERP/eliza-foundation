import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import {
  AddOrderLineUseCase,
  CancelOrderUseCase,
  CloseOrderUseCase,
  ConfirmOrderUseCase,
  CreateSalesOrderUseCase,
  DispatchOrderUseCase,
  GetSalesOrderByIdUseCase,
  ListSalesOrdersUseCase,
  OrdenVentaView,
  RemoveOrderLineUseCase,
  ReserveOrderStockUseCase,
} from '@eliza/contexts/sales/application';
import {
  AddOrderLineDto,
  CancelOrderDto,
  CreateSalesOrderDto,
  ListSalesOrdersQueryDto,
} from '@eliza/contexts/sales/interface/http/dto/sales.dto';

// Sales.Salesperson es el rol real del vendedor (role-catalog.ts); Sales.Operator y
// Sales.Reader no existen todavia en el catalogo de roles y se conservan por compatibilidad.
const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Sales.Manager', 'Sales.Salesperson', 'Sales.Operator', 'Sales.Reader',
  'Inventory.Manager', 'Billing.Manager', 'Logistics.Manager',
];
const WRITER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Sales.Manager', 'Sales.Operator',
];
// El vendedor arma el pedido en Borrador (crear, agregar y quitar lineas); confirmar,
// reservar, despachar, cancelar y cerrar siguen siendo de WRITER_ROLES / Sales.Manager.
const ORDER_AUTHOR_ROLES = [...WRITER_ROLES, 'Sales.Salesperson'];

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  const e = r.error;
  if (e.category === 'not_found') throw new NotFoundException(e.message);
  if (e.category === 'conflict') throw new ConflictException({ code: e.code, message: e.message, details: e.details });
  throw new BadRequestException({ code: e.code, message: e.message, details: e.details });
}

@ApiTags('Sales · Orders')
@ApiBearerAuth()
@Controller({ path: 'sales/orders', version: '1' })
export class SalesOrdersController {
  constructor(
    private readonly createOrder: CreateSalesOrderUseCase,
    private readonly addLine: AddOrderLineUseCase,
    private readonly removeLine: RemoveOrderLineUseCase,
    private readonly confirmOrder: ConfirmOrderUseCase,
    private readonly reserveStock: ReserveOrderStockUseCase,
    private readonly dispatchOrder: DispatchOrderUseCase,
    private readonly cancelOrder: CancelOrderUseCase,
    private readonly closeOrder: CloseOrderUseCase,
    private readonly getOrder: GetSalesOrderByIdUseCase,
    private readonly listOrders: ListSalesOrdersUseCase,
  ) {}

  @Post()
  @RequireRoles(...ORDER_AUTHOR_ROLES)
  @ApiOperation({ summary: 'Create a sales order in Borrador state' })
  @ApiResponse({ status: 201, description: 'Order created' })
  async create(@Body() dto: CreateSalesOrderDto): Promise<OrdenVentaView> {
    return unwrap(await this.createOrder.execute(dto));
  }

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'List sales orders with filters' })
  async list(@Query() q: ListSalesOrdersQueryDto) {
    return unwrap(await this.listOrders.execute(q));
  }

  @Get(':id')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Get sales order detail with lines' })
  async one(@Param('id', ParseUUIDPipe) id: string): Promise<OrdenVentaView> {
    const r = await this.getOrder.execute({ ordenId: id });
    const v = unwrap(r);
    if (!v) throw new NotFoundException(`Sales order ${id} not found`);
    return v;
  }

  @Post(':id/lines')
  @RequireRoles(...ORDER_AUTHOR_ROLES)
  @ApiOperation({ summary: 'Add a product line to the order (only in Borrador)' })
  @ApiResponse({ status: 201, description: 'Line added' })
  async addOrderLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddOrderLineDto,
  ): Promise<OrdenVentaView> {
    return unwrap(await this.addLine.execute({ ordenId: id, ...dto }));
  }

  @Delete(':id/lines/:lineaId')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...ORDER_AUTHOR_ROLES)
  @ApiOperation({ summary: 'Remove a line from the order (only in Borrador)' })
  async removeOrderLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineaId', ParseUUIDPipe) lineaId: string,
  ): Promise<OrdenVentaView> {
    return unwrap(await this.removeLine.execute({ ordenId: id, lineaId }));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Confirm order (locks lines, emits OrderConfirmed)' })
  @ApiResponse({ status: 200, description: 'Order confirmed, ready to reserve stock' })
  async confirm(@Param('id', ParseUUIDPipe) id: string): Promise<OrdenVentaView> {
    return unwrap(await this.confirmOrder.execute({ ordenId: id }));
  }

  @Post(':id/reserve')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Reserve stock via FEFO for all order lines' })
  @ApiResponse({ status: 200, description: 'Stock reserved successfully' })
  @ApiResponse({ status: 409, description: 'Insufficient stock for one or more lines' })
  async reserve(@Param('id', ParseUUIDPipe) id: string) {
    return unwrap(await this.reserveStock.execute({ ordenId: id }));
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Dispatch reserved stock (materializes reservations)' })
  @ApiResponse({ status: 200, description: 'Stock dispatched from inventory' })
  async dispatch(@Param('id', ParseUUIDPipe) id: string) {
    return unwrap(await this.dispatchOrder.execute({ ordenId: id }));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES, 'Sales.Manager')
  @ApiOperation({ summary: 'Cancel order (releases reservations if reserved)' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrdenVentaView> {
    return unwrap(await this.cancelOrder.execute({ ordenId: id, ...dto }));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('Platform.Admin', 'Tenant.Admin', 'Sales.Manager')
  @ApiOperation({ summary: 'Close order (archive, only from Despachada)' })
  async close(@Param('id', ParseUUIDPipe) id: string): Promise<OrdenVentaView> {
    return unwrap(await this.closeOrder.execute({ ordenId: id }));
  }
}