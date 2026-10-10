import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import {
  CancelJornadaUseCase,
  CreateJornadaUseCase,
  GetJornadaUseCase,
  JornadaView,
  ListJornadasUseCase,
  ReserveJornadaUseCase,
  StartJornadaUseCase,
} from '@eliza/contexts/manufacturing/application';
import {
  CancelProductionOrderDto,
  CreateJornadaDto,
  ListJornadasQueryDto,
} from '@eliza/contexts/manufacturing/interface/http/dto/manufacturing.dto';
import { JornadaCodigoPipe } from '@eliza/contexts/manufacturing/interface/http/jornada-codigo.pipe';

// Mismos roles que las órdenes de producción (production-orders.controller.ts)
const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Manufacturing.Manager', 'Manufacturing.Operator', 'Manufacturing.Reader',
  'Inventory.Manager', 'Quality.Manager', 'Planning.Manager',
];
const WRITER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Manufacturing.Manager', 'Manufacturing.Operator',
];

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  throw r.error;
}

/**
 * Jornadas de producción (Sprint 15): varias órdenes —una por producto— del
 * mismo día de planta. Reservar, iniciar y cancelar van juntas; registrar
 * lotes y completar siguen por orden (/manufacturing/orders/:id/...).
 */
@ApiTags('Manufacturing · Jornadas')
@ApiBearerAuth()
@Controller({ path: 'manufacturing/jornadas', version: '1' })
export class JornadasController {
  constructor(
    private readonly create: CreateJornadaUseCase,
    private readonly list: ListJornadasUseCase,
    private readonly get: GetJornadaUseCase,
    private readonly reserve: ReserveJornadaUseCase,
    private readonly start: StartJornadaUseCase,
    private readonly cancel: CancelJornadaUseCase,
  ) {}

  @Post()
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Create a production day with several finished products (one order each)' })
  @ApiResponse({ status: 201, description: 'Jornada created; every order Planificada' })
  async createJornada(@Body() dto: CreateJornadaDto): Promise<JornadaView> {
    return unwrap(await this.create.execute(dto));
  }

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Recent production days' })
  async listJornadas(@Query() q: ListJornadasQueryDto) {
    return unwrap(await this.list.execute({ limit: q.limit }));
  }

  @Get(':codigo')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Production day with its orders' })
  async one(@Param('codigo', JornadaCodigoPipe) codigo: string): Promise<JornadaView> {
    return unwrap(await this.get.execute({ codigo }));
  }

  @Post(':codigo/reserve-materials')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Reserve raw materials for every product, all or nothing' })
  @ApiResponse({ status: 409, description: 'Insufficient stock; nothing stays reserved' })
  async reserveMaterials(@Param('codigo', JornadaCodigoPipe) codigo: string): Promise<JornadaView> {
    return unwrap(await this.reserve.execute({ codigo }));
  }

  @Post(':codigo/start')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Start every planned product (materials must be reserved)' })
  async startJornada(@Param('codigo', JornadaCodigoPipe) codigo: string): Promise<JornadaView> {
    return unwrap(await this.start.execute({ codigo }));
  }

  @Post(':codigo/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES, 'Quality.Manager')
  @ApiOperation({ summary: 'Cancel every active product (releases reservations); completed ones stay' })
  async cancelJornada(
    @Param('codigo', JornadaCodigoPipe) codigo: string,
    @Body() dto: CancelProductionOrderDto,
  ): Promise<JornadaView> {
    return unwrap(await this.cancel.execute({ codigo, motivo: dto.motivo }));
  }
}
