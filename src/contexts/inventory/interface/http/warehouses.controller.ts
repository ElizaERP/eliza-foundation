import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import {
  CreateLocationUseCase,
  CreateWarehouseUseCase,
  ListLocationsUseCase,
  ListWarehousesUseCase,
  LocationView,
  WarehouseView,
} from '@eliza/contexts/inventory/application';
import {
  CreateLocationDto,
  CreateWarehouseDto,
} from '@eliza/contexts/inventory/interface/http/dto/inventory.dto';

const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Inventory.Manager', 'Inventory.Operator', 'Inventory.Reader',
  'Manufacturing.Manager', 'Logistics.Manager', 'Sales.Manager',
];
const WRITER_ROLES = ['Platform.Admin', 'Tenant.Admin', 'Inventory.Manager'];

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  const e = r.error;
  if (e.category === 'not_found') throw new NotFoundException(e.message);
  if (e.category === 'conflict') throw new ConflictException({ code: e.code, message: e.message });
  throw new BadRequestException({ code: e.code, message: e.message, details: e.details });
}

@ApiTags('Inventory · Warehouses')
@ApiBearerAuth()
@Controller({ path: 'inventory/warehouses', version: '1' })
export class WarehousesController {
  constructor(
    private readonly createWarehouse: CreateWarehouseUseCase,
    private readonly createLocation: CreateLocationUseCase,
    private readonly listWarehouses: ListWarehousesUseCase,
    private readonly listLocations: ListLocationsUseCase,
  ) {}

  @Post()
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Create a warehouse' })
  async create(@Body() dto: CreateWarehouseDto): Promise<WarehouseView> {
    return unwrap(await this.createWarehouse.execute(dto));
  }

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'List warehouses' })
  async list(@Query('activeOnly') activeOnly?: string): Promise<WarehouseView[]> {
    return unwrap(await this.listWarehouses.execute({ activeOnly: activeOnly !== 'false' }));
  }

  @Post(':warehouseId/locations')
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Create a location within a warehouse' })
  async createLoc(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() dto: CreateLocationDto,
  ): Promise<LocationView> {
    return unwrap(await this.createLocation.execute({ warehouseId, ...dto }));
  }

  @Get(':warehouseId/locations')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'List locations within a warehouse' })
  async listLocs(
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<LocationView[]> {
    return unwrap(await this.listLocations.execute({
      warehouseId,
      activeOnly: activeOnly !== 'false',
    }));
  }
}
