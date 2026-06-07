import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '@eliza/shared-kernel/application/ports';
import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  CLIENTE_REPOSITORY,
  Cliente,
  ClienteFilter,
  ClienteId,
  ClienteRepository,
  CondicionesPago,
  EstadoCliente,
} from '@eliza/contexts/sales/domain';
import {
  ClienteListView,
  ClienteView,
  toClienteListView,
  toClienteView,
} from '@eliza/contexts/sales/application/dto/sales.views';

// =====================================================================
// 1. CreateCustomer
// =====================================================================

export interface CreateCustomerInput {
  codigo: string;
  nit: string;
  razonSocial: string;
  nombreComercial?: string;
  condicionesPago?: CondicionesPago;
  direccionFiscal: {
    direccion: string;
    ciudad: string;
    departamento: string;
    telefono?: string;
    notas?: string;
  };
  direccionEntrega?: {
    direccion: string;
    ciudad: string;
    departamento: string;
    telefono?: string;
    notas?: string;
  };
  contactoNombre?: string;
  contactoTelefono?: string;
  contactoEmail?: string;
  notas?: string;
}

@Injectable()
export class CreateCustomerUseCase implements UseCase<CreateCustomerInput, ClienteView> {
  private readonly logger = new Logger(CreateCustomerUseCase.name);

  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly repo: ClienteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateCustomerInput): Promise<Result<ClienteView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const now = this.clock.now();

    // Unicidad de código
    const existingCode = await this.repo.findByCodigo(input.codigo);
    if (existingCode) {
      return err(applicationError('sales.customer_code_exists',
        `Customer with code ${input.codigo} already exists`, 'conflict'));
    }

    // Unicidad de NIT
    const normalizedNit = input.nit.replace(/[.\s]/g, '').trim();
    const existingNit = await this.repo.findByNit(normalizedNit);
    if (existingNit) {
      return err(applicationError('sales.customer_nit_exists',
        `Customer with NIT ${normalizedNit} already exists`, 'conflict'));
    }

    const clienteR = Cliente.create({
      tenantId,
      codigo: input.codigo,
      nit: input.nit,
      razonSocial: input.razonSocial,
      nombreComercial: input.nombreComercial,
      condicionesPago: input.condicionesPago,
      direccionFiscal: input.direccionFiscal,
      direccionEntrega: input.direccionEntrega,
      contactoNombre: input.contactoNombre,
      contactoTelefono: input.contactoTelefono,
      contactoEmail: input.contactoEmail,
      notas: input.notas,
      now,
    });
    if (clienteR.isErr) {
      return err(applicationError(clienteR.error.code, clienteR.error.message, 'validation'));
    }

    await this.repo.save(clienteR.value);
    this.logger.log(`Customer ${input.codigo} (${input.razonSocial}) created`);
    return ok(toClienteView(clienteR.value));
  }
}

// =====================================================================
// 2. UpdateCustomer
// =====================================================================

export interface UpdateCustomerInput {
  clienteId: string;
  razonSocial?: string;
  nombreComercial?: string;
  condicionesPago?: CondicionesPago;
  direccionFiscal?: {
    direccion: string;
    ciudad: string;
    departamento: string;
    telefono?: string;
    notas?: string;
  };
  direccionEntrega?: {
    direccion: string;
    ciudad: string;
    departamento: string;
    telefono?: string;
    notas?: string;
  } | null;
  contactoNombre?: string;
  contactoTelefono?: string;
  contactoEmail?: string;
  notas?: string;
}

@Injectable()
export class UpdateCustomerUseCase implements UseCase<UpdateCustomerInput, ClienteView> {
  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly repo: ClienteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: UpdateCustomerInput): Promise<Result<ClienteView, ApplicationError>> {
    const now = this.clock.now();

    const cliente = await this.repo.findById(ClienteId.fromString(input.clienteId));
    if (!cliente) {
      return err(applicationError('sales.customer_not_found',
        `Customer ${input.clienteId} not found`, 'not_found'));
    }

    const updateR = cliente.update({
      razonSocial: input.razonSocial,
      nombreComercial: input.nombreComercial,
      condicionesPago: input.condicionesPago,
      direccionFiscal: input.direccionFiscal,
      direccionEntrega: input.direccionEntrega,
      contactoNombre: input.contactoNombre,
      contactoTelefono: input.contactoTelefono,
      contactoEmail: input.contactoEmail,
      notas: input.notas,
      now,
    });
    if (updateR.isErr) {
      return err(applicationError(updateR.error.code, updateR.error.message, 'validation'));
    }

    await this.repo.save(cliente);
    return ok(toClienteView(cliente));
  }
}

// =====================================================================
// 3. SuspendCustomer
// =====================================================================

@Injectable()
export class SuspendCustomerUseCase implements UseCase<{ clienteId: string }, ClienteView> {
  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly repo: ClienteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { clienteId: string }): Promise<Result<ClienteView, ApplicationError>> {
    const cliente = await this.repo.findById(ClienteId.fromString(input.clienteId));
    if (!cliente) {
      return err(applicationError('sales.customer_not_found',
        `Customer ${input.clienteId} not found`, 'not_found'));
    }

    const r = cliente.suspend(this.clock.now());
    if (r.isErr) {
      return err(applicationError(r.error.code, r.error.message, 'validation'));
    }

    await this.repo.save(cliente);
    return ok(toClienteView(cliente));
  }
}

// =====================================================================
// 4. ActivateCustomer
// =====================================================================

@Injectable()
export class ActivateCustomerUseCase implements UseCase<{ clienteId: string }, ClienteView> {
  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly repo: ClienteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { clienteId: string }): Promise<Result<ClienteView, ApplicationError>> {
    const cliente = await this.repo.findById(ClienteId.fromString(input.clienteId));
    if (!cliente) {
      return err(applicationError('sales.customer_not_found',
        `Customer ${input.clienteId} not found`, 'not_found'));
    }

    const r = cliente.activate(this.clock.now());
    if (r.isErr) {
      return err(applicationError(r.error.code, r.error.message, 'validation'));
    }

    await this.repo.save(cliente);
    return ok(toClienteView(cliente));
  }
}

// =====================================================================
// 5. GetCustomerById
// =====================================================================

@Injectable()
export class GetCustomerByIdUseCase implements UseCase<{ clienteId: string }, ClienteView | null> {
  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly repo: ClienteRepository,
  ) {}

  async execute(input: { clienteId: string }): Promise<Result<ClienteView | null, ApplicationError>> {
    const cliente = await this.repo.findById(ClienteId.fromString(input.clienteId));
    if (!cliente) return ok(null);
    return ok(toClienteView(cliente));
  }
}

// =====================================================================
// 6. ListCustomers
// =====================================================================

export interface ListCustomersInput {
  estado?: EstadoCliente;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListCustomersOutput {
  items: ClienteListView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class ListCustomersUseCase implements UseCase<ListCustomersInput, ListCustomersOutput> {
  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly repo: ClienteRepository,
  ) {}

  async execute(input: ListCustomersInput): Promise<Result<ListCustomersOutput, ApplicationError>> {
    const filter: ClienteFilter = {
      estado: input.estado,
      search: input.search,
      limit: Math.min(input.limit ?? 50, 200),
      offset: input.offset ?? 0,
    };
    const [items, total] = await Promise.all([
      this.repo.list(filter),
      this.repo.countBy(filter),
    ]);
    return ok({
      items: items.map(toClienteListView),
      total,
      limit: filter.limit,
      offset: filter.offset,
    });
  }
}