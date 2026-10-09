import {
  Body,
  Controller,
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
  CancelProductionOrderUseCase,
  CompleteProductionOrderUseCase,
  CreateProductionOrderUseCase,
  GetProductionOrderByIdUseCase,
  ListProductionOrdersUseCase,
  OrdenProduccionView,
  RecordConsumptionUseCase,
  RecordProductionUseCase,
  ReserveMaterialsUseCase,
  StartProductionUseCase,
} from '@eliza/contexts/manufacturing/application';
import {
  CancelProductionOrderDto,
  CreateProductionOrderDto,
  ListProductionOrdersQueryDto,
  RecordConsumptionDto,
  RecordProductionDto,
} from '@eliza/contexts/manufacturing/interface/http/dto/manufacturing.dto';

const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Manufacturing.Manager', 'Manufacturing.Operator', 'Manufacturing.Reader',
  'Inventory.Manager', 'Quality.Manager', 'Planning.Manager',
];
const WRITER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Manufacturing.Manager', 'Manufacturing.Operator',
];

/** Lanza el ApplicationError tal cual: el filtro global conserva el código (ver Ventas). */
function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  throw r.error;
}

@ApiTags('Manufacturing · Production Orders')
@ApiBearerAuth()
@Controller({ path: 'manufacturing/orders', version: '1' })
export class ProductionOrdersController {
  constructor(
    private readonly createOrder: CreateProductionOrderUseCase,
    private readonly reserveMaterials: ReserveMaterialsUseCase,
    private readonly startProduction: StartProductionUseCase,
    private readonly recordConsumption: RecordConsumptionUseCase,
    private readonly recordProduction: RecordProductionUseCase,
    private readonly completeOrder: CompleteProductionOrderUseCase,
    private readonly cancelOrder: CancelProductionOrderUseCase,
    private readonly getOrder: GetProductionOrderByIdUseCase,
    private readonly listOrders: ListProductionOrdersUseCase,
  ) {}

  @Post()
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Create a production order (captures BOM snapshot)' })
  @ApiResponse({ status: 201, description: 'Order created in Planificada state' })
  async create(@Body() dto: CreateProductionOrderDto): Promise<OrdenProduccionView> {
    return unwrap(await this.createOrder.execute(dto));
  }

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'List production orders with filters' })
  async list(@Query() q: ListProductionOrdersQueryDto) {
    return unwrap(await this.listOrders.execute(q));
  }

  @Get(':id')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Get production order detail' })
  async one(@Param('id', ParseUUIDPipe) id: string): Promise<OrdenProduccionView> {
    const r = await this.getOrder.execute({ ordenId: id });
    const v = unwrap(r);
    if (!v) throw new NotFoundException(`Production order ${id} not found`);
    return v;
  }

  @Post(':id/reserve-materials')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Reserve raw materials via FEFO (all BOM components)' })
  @ApiResponse({ status: 200, description: 'Materials reserved successfully' })
  @ApiResponse({ status: 409, description: 'Insufficient stock for one or more components' })
  async reserve(@Param('id', ParseUUIDPipe) id: string) {
    return unwrap(await this.reserveMaterials.execute({ ordenId: id }));
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Start production (requires materials reserved)' })
  async start(@Param('id', ParseUUIDPipe) id: string): Promise<OrdenProduccionView> {
    return unwrap(await this.startProduction.execute({ ordenId: id }));
  }

  @Post(':id/consumption')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Record raw material consumption (traceability)' })
  async consume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordConsumptionDto,
  ): Promise<OrdenProduccionView> {
    return unwrap(await this.recordConsumption.execute({ ordenId: id, ...dto }));
  }

  @Post(':id/production')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Record finished product lot (creates Lot + Stock in Inventory)' })
  @ApiResponse({ status: 201, description: 'Lot created and stock received in Inventory' })
  async produce(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordProductionDto,
  ): Promise<OrdenProduccionView> {
    return unwrap(await this.recordProduction.execute({ ordenId: id, ...dto }));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Complete production order: consumes reserved raw materials (backflush) and closes; requires at least one produced lot' })
  async complete(@Param('id', ParseUUIDPipe) id: string): Promise<OrdenProduccionView> {
    return unwrap(await this.completeOrder.execute({ ordenId: id }));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES, 'Quality.Manager')
  @ApiOperation({ summary: 'Cancel production order (releases pending reservations)' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelProductionOrderDto,
  ): Promise<OrdenProduccionView> {
    return unwrap(await this.cancelOrder.execute({ ordenId: id, ...dto }));
  }
}