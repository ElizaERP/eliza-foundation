import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import {
  AdjustStockUseCase,
  DispatchInventoryUseCase,
  ExistenciaView,
  GetStockBySkuUseCase,
  ReceiveInventoryUseCase,
  RegisterReceiptUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
  StockSummaryView,
  TransferStockUseCase,
} from '@eliza/contexts/inventory/application';
import {
  AdjustStockDto,
  DispatchInventoryDto,
  ReceiveInventoryDto,
  RegisterReceiptDto,
  ReleaseReservationDto,
  ReserveStockDto,
  TransferStockDto,
} from '@eliza/contexts/inventory/interface/http/dto/inventory.dto';

const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Inventory.Manager', 'Inventory.Operator', 'Inventory.Reader',
  'Manufacturing.Manager', 'Sales.Manager',
];
const WRITER_ROLES = [
  'Platform.Admin', 'Tenant.Admin', 'Inventory.Manager', 'Inventory.Operator',
];

/**
 * Errores de aplicación: se lanzan tal cual y el filtro Problem Details los
 * convierte (not_found 404, conflict 409, validation 400...) conservando el
 * código y los detalles, que la app usa para mostrar el mensaje correcto.
 */
function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  throw r.error;
}

@ApiTags('Inventory · Stock')
@ApiBearerAuth()
@Controller({ path: 'inventory/stock', version: '1' })
export class StockController {
  constructor(
    private readonly receive: ReceiveInventoryUseCase,
    private readonly reserve: ReserveStockUseCase,
    private readonly releaseRes: ReleaseReservationUseCase,
    private readonly adjust: AdjustStockUseCase,
    private readonly transfer: TransferStockUseCase,
    private readonly dispatch: DispatchInventoryUseCase,
    private readonly getStock: GetStockBySkuUseCase,
    private readonly registerReceipt: RegisterReceiptUseCase,
  ) {}

  @Post('receive')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Receive inventory into stock' })
  async doReceive(@Body() dto: ReceiveInventoryDto) {
    return unwrap(await this.receive.execute(dto));
  }

  /**
   * Recibir mercancía (Sprint 13): crea el lote y lo ingresa en un paso.
   * La pueden hacer los operarios de bodega (mismos roles que /receive): es su
   * trabajo diario. Registrar un lote suelto (POST /lots) sigue siendo de gerente.
   */
  @Post('receipts')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Receive goods: create the lot and put it into stock in one step' })
  @ApiResponse({ status: 201, description: 'Lot created and received' })
  @ApiResponse({ status: 409, description: 'Lot code already exists for this product' })
  async doRegisterReceipt(@Body() dto: RegisterReceiptDto) {
    return unwrap(await this.registerReceipt.execute(dto));
  }

  @Post('reserve')
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITER_ROLES, 'Sales.Manager', 'Manufacturing.Manager')
  @ApiOperation({ summary: 'Reserve stock with FEFO across multiple lots' })
  @ApiResponse({ status: 201, description: 'Stock reserved' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  async doReserve(@Body() dto: ReserveStockDto) {
    return unwrap(await this.reserve.execute(dto));
  }

  @Delete('reservations')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES, 'Sales.Manager', 'Manufacturing.Manager')
  @ApiOperation({ summary: 'Release reservations by reference' })
  async doRelease(@Body() dto: ReleaseReservationDto) {
    return unwrap(await this.releaseRes.execute(dto));
  }

  @Post('adjust/:existenciaId')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Adjust stock quantity (cyclic count / shrinkage)' })
  async doAdjust(
    @Param('existenciaId', ParseUUIDPipe) existenciaId: string,
    @Body() dto: AdjustStockDto,
  ): Promise<ExistenciaView> {
    return unwrap(await this.adjust.execute({ existenciaId, ...dto }));
  }

  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Transfer stock between locations' })
  async doTransfer(@Body() dto: TransferStockDto) {
    return unwrap(await this.transfer.execute(dto));
  }

  @Post('dispatch')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES, 'Sales.Manager')
  @ApiOperation({ summary: 'Dispatch reserved stock (materializes reservation)' })
  async doDispatch(@Body() dto: DispatchInventoryDto) {
    return unwrap(await this.dispatch.execute(dto));
  }

  @Get('by-sku/:productId')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Get stock summary for a product, grouped by lot' })
  async byProduct(@Param('productId', ParseUUIDPipe) productId: string): Promise<StockSummaryView> {
    return unwrap(await this.getStock.execute({ productId }));
  }
}
