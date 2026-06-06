import { Inject, Injectable } from '@nestjs/common';
import { CLOCK_PORT, ClockPort, TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { ApplicationError, UseCase, applicationError } from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';
import { LOCATION_REPOSITORY, Location, LocationRepository, TipoUbicacion, WAREHOUSE_REPOSITORY, Warehouse, WarehouseId, WarehouseRepository } from '@eliza/contexts/inventory/domain';
import { LocationView, WarehouseView, toLocationView, toWarehouseView } from '@eliza/contexts/inventory/application/dto/inventory.views';

export interface CreateWarehouseInput { code: string; name: string; address?: string; }

@Injectable()
export class CreateWarehouseUseCase implements UseCase<CreateWarehouseInput, WarehouseView> {
  constructor(
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouseRepo: WarehouseRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}
  async execute(input: CreateWarehouseInput): Promise<Result<WarehouseView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const existing = await this.warehouseRepo.findByCode(input.code);
    if (existing) return err(applicationError('warehouse.code_exists', `Warehouse with code ${input.code} already exists`, 'conflict'));
    const wR = Warehouse.create({ tenantId, code: input.code, name: input.name, address: input.address, now: this.clock.now() });
    if (wR.isErr) return err(applicationError(wR.error.code, wR.error.message, 'validation'));
    await this.warehouseRepo.save(wR.value);
    return ok(toWarehouseView(wR.value));
  }
}

export interface CreateLocationInput { warehouseId: string; code: string; name: string; tipoUbicacion: TipoUbicacion; tempMinC?: number; tempMaxC?: number; capacidadMax?: number; }

@Injectable()
export class CreateLocationUseCase implements UseCase<CreateLocationInput, LocationView> {
  constructor(
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouseRepo: WarehouseRepository,
    @Inject(LOCATION_REPOSITORY) private readonly locationRepo: LocationRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}
  async execute(input: CreateLocationInput): Promise<Result<LocationView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const warehouse = await this.warehouseRepo.findById(WarehouseId.fromString(input.warehouseId));
    if (!warehouse) return err(applicationError('warehouse.not_found', `Warehouse ${input.warehouseId} not found`, 'not_found'));
    const existing = await this.locationRepo.findByCode(input.warehouseId, input.code);
    if (existing) return err(applicationError('location.code_exists', `Location with code ${input.code} already exists`, 'conflict'));
    const locR = Location.create({ tenantId, warehouseId: input.warehouseId, code: input.code, name: input.name, tipoUbicacion: input.tipoUbicacion, tempMinC: input.tempMinC, tempMaxC: input.tempMaxC, capacidadMax: input.capacidadMax, now: this.clock.now() });
    if (locR.isErr) return err(applicationError(locR.error.code, locR.error.message, 'validation'));
    await this.locationRepo.save(locR.value);
    return ok(toLocationView(locR.value));
  }
}

@Injectable()
export class ListWarehousesUseCase implements UseCase<{ activeOnly?: boolean }, WarehouseView[]> {
  constructor(@Inject(WAREHOUSE_REPOSITORY) private readonly warehouseRepo: WarehouseRepository) {}
  async execute(input: { activeOnly?: boolean }): Promise<Result<WarehouseView[], ApplicationError>> {
    const list = await this.warehouseRepo.list(input.activeOnly ?? true);
    return ok(list.map(toWarehouseView));
  }
}

@Injectable()
export class ListLocationsUseCase implements UseCase<{ warehouseId: string; activeOnly?: boolean }, LocationView[]> {
  constructor(@Inject(LOCATION_REPOSITORY) private readonly locationRepo: LocationRepository) {}
  async execute(input: { warehouseId: string; activeOnly?: boolean }): Promise<Result<LocationView[], ApplicationError>> {
    const list = await this.locationRepo.listByWarehouse(input.warehouseId, input.activeOnly ?? true);
    return ok(list.map(toLocationView));
  }
}
