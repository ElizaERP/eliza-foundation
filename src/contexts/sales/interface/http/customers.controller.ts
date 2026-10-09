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
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import {
  ActivateCustomerUseCase,
  ClienteView,
  CreateCustomerUseCase,
  GetCustomerByIdUseCase,
  ListCustomersUseCase,
  SuspendCustomerUseCase,
  UpdateCustomerUseCase,
} from '@eliza/contexts/sales/application';
import {
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from '@eliza/contexts/sales/interface/http/dto/sales.dto';

// Sales.Salesperson (rol real del vendedor) necesita ver sus clientes para armar pedidos;
// Sales.Operator y Sales.Reader no existen todavia en role-catalog.ts.
const READER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Sales.Manager', 'Sales.Salesperson', 'Sales.Operator', 'Sales.Reader',
  'Billing.Manager', 'Logistics.Manager',
];
const WRITER_ROLES = [
  'Platform.Admin', 'Tenant.Admin',
  'Sales.Manager', 'Sales.Operator',
];

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  const e = r.error;
  if (e.category === 'not_found') throw new NotFoundException(e.message);
  if (e.category === 'conflict') throw new ConflictException({ code: e.code, message: e.message });
  throw new BadRequestException({ code: e.code, message: e.message, details: e.details });
}

@ApiTags('Sales · Customers')
@ApiBearerAuth()
@Controller({ path: 'sales/customers', version: '1' })
export class CustomersController {
  constructor(
    private readonly createCustomer: CreateCustomerUseCase,
    private readonly updateCustomer: UpdateCustomerUseCase,
    private readonly suspendCustomer: SuspendCustomerUseCase,
    private readonly activateCustomer: ActivateCustomerUseCase,
    private readonly getCustomer: GetCustomerByIdUseCase,
    private readonly listCustomers: ListCustomersUseCase,
  ) {}

  @Post()
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Create a new customer' })
  async create(@Body() dto: CreateCustomerDto): Promise<ClienteView> {
    return unwrap(await this.createCustomer.execute(dto));
  }

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'List customers with search and filters' })
  async list(@Query() q: ListCustomersQueryDto) {
    return unwrap(await this.listCustomers.execute(q));
  }

  @Get(':id')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Get customer detail' })
  async one(@Param('id', ParseUUIDPipe) id: string): Promise<ClienteView> {
    const r = await this.getCustomer.execute({ clienteId: id });
    const v = unwrap(r);
    if (!v) throw new NotFoundException(`Customer ${id} not found`);
    return v;
  }

  @Patch(':id')
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Update customer data' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<ClienteView> {
    return unwrap(await this.updateCustomer.execute({ clienteId: id, ...dto }));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('Platform.Admin', 'Tenant.Admin', 'Sales.Manager')
  @ApiOperation({ summary: 'Suspend customer (blocks new orders)' })
  async suspend(@Param('id', ParseUUIDPipe) id: string): Promise<ClienteView> {
    return unwrap(await this.suspendCustomer.execute({ clienteId: id }));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('Platform.Admin', 'Tenant.Admin', 'Sales.Manager')
  @ApiOperation({ summary: 'Reactivate a suspended customer' })
  async activate(@Param('id', ParseUUIDPipe) id: string): Promise<ClienteView> {
    return unwrap(await this.activateCustomer.execute({ clienteId: id }));
  }
}