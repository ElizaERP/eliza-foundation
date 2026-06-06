import {
  BadRequestException,
  Body,
  ConflictException,
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
import {
  ApplicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import {
  BlockLotUseCase,
  GetLotByIdUseCase,
  ListExpiringLotsUseCase,
  ListLotsByProductUseCase,
  LoteView,
  RegisterLotUseCase,
  ReleaseLotUseCase,
} from '@eliza/contexts/inventory/application';
import {
  BlockLotDto,
  ListExpiringQueryDto,
  RegisterLotDto,
} from '@eliza/contexts/inventory/interface/http/dto/inventory.dto';

const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Inventory.Manager', 'Inventory.Operator', 'Inventory.Reader',
  'Manufacturing.Manager', 'Manufacturing.Operator',
  'Sales.Manager', 'Quality.Manager',
];
const WRITER_ROLES = ['Platform.Admin', 'Tenant.Admin', 'Inventory.Manager'];

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  const e = r.error;
  if (e.category === 'not_found') throw new NotFoundException(e.message);
  if (e.category === 'conflict') throw new ConflictException({ code: e.code, message: e.message });
  throw new BadRequestException({ code: e.code, message: e.message, details: e.details });
}

@ApiTags('Inventory · Lots')
@ApiBearerAuth()
@Controller({ path: 'inventory/lots', version: '1' })
export class LotsController {
  constructor(
    private readonly registerLot: RegisterLotUseCase,
    private readonly blockLot: BlockLotUseCase,
    private readonly releaseLot: ReleaseLotUseCase,
    private readonly getLot: GetLotByIdUseCase,
    private readonly listExpiring: ListExpiringLotsUseCase,
    private readonly listByProduct: ListLotsByProductUseCase,
  ) {}

  @Post()
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Register a new lot' })
  @ApiResponse({ status: 201, description: 'Lot registered' })
  async create(@Body() dto: RegisterLotDto): Promise<LoteView> {
    return unwrap(await this.registerLot.execute(dto));
  }

  @Get('expiring')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'List lots expiring within N days' })
  async expiring(@Query() q: ListExpiringQueryDto): Promise<LoteView[]> {
    return unwrap(await this.listExpiring.execute({
      withinDays: q.withinDays ?? 30,
      limit: q.limit ?? 100,
    }));
  }

  @Get('by-product/:productId')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'List lots for a given product' })
  async byProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<LoteView[]> {
    return unwrap(await this.listByProduct.execute({
      productId, limit: limit ? +limit : undefined, offset: offset ? +offset : undefined,
    }));
  }

  @Get(':id')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Get a single lot' })
  async one(@Param('id', ParseUUIDPipe) id: string): Promise<LoteView> {
    const r = await this.getLot.execute({ loteId: id });
    const v = unwrap(r);
    if (!v) throw new NotFoundException(`Lote ${id} not found`);
    return v;
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES, 'Quality.Manager')
  @ApiOperation({ summary: 'Block a lot (e.g. by Quality decision)' })
  async block(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockLotDto,
  ): Promise<LoteView> {
    return unwrap(await this.blockLot.execute({ loteId: id, reason: dto.reason }));
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES, 'Quality.Manager')
  @ApiOperation({ summary: 'Release a previously blocked lot' })
  async release(@Param('id', ParseUUIDPipe) id: string): Promise<LoteView> {
    return unwrap(await this.releaseLot.execute({ loteId: id }));
  }
}
