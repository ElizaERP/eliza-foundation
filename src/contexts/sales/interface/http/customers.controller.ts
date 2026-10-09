import {
  Body,
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
import { CurrentUser } from '@eliza/contexts/iam/infrastructure/auth/auth.guards';
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
// El vendedor registra clientes nuevos (siempre a Contado) para no frenar un pedido;
// editar, suspender, activar y otorgar credito siguen siendo de WRITER_ROLES / Sales.Manager.
const CUSTOMER_CREATOR_ROLES = [...WRITER_ROLES, 'Sales.Salesperson'];
const CREDIT_GRANTER_ROLES = ['Platform.Admin', 'Tenant.Admin', 'Sales.Manager'];

/**
 * Devuelve el valor o lanza el ApplicationError tal cual: el filtro global
 * (Problem Details) lo convierte en 404 / 409 / 400 según su categoría y
 * conserva el código (p. ej. sales.insufficient_stock) y los detalles, que la
 * app usa para mostrar el mensaje correcto.
 */
function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isOk) return r.value;
  throw r.error;
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
  @RequireRoles(...CUSTOMER_CREATOR_ROLES)
  @ApiOperation({ summary: 'Create a new customer (Sales.Salesperson: only Contado)' })
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser('roles') roles: string[] = [],
  ): Promise<ClienteView> {
    const puedeOtorgarCredito = roles.some((r) => CREDIT_GRANTER_ROLES.includes(r));
    return unwrap(await this.createCustomer.execute({ ...dto, puedeOtorgarCredito }));
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