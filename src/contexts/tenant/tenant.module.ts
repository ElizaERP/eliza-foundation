import { Module, Provider } from '@nestjs/common';

import { TENANT_ACCESS_PORT } from '@eliza/shared-kernel/application/ports';

import {
  ActivateTenant,
  ChangePlan,
  CreateTenant,
  DeleteTenant,
  GetMyTenant,
  GetTenantByCode,
  GetTenantById,
  ListTenants,
  RenameTenant,
  SuspendTenant,
} from './application';
import { TENANT_REPOSITORY } from './domain';
import { PrismaTenantAccess } from './infrastructure/access/prisma-tenant-access';
import { PrismaTenantRepository } from './infrastructure/persistence/prisma-tenant.repository';
import { MyTenantController } from './interface/http/my-tenant.controller';
import { PlatformTenantsController } from './interface/http/platform-tenants.controller';

/**
 * Tenant Bounded Context — wiring NestJS.
 *
 * Estructura Hexagonal:
 *   - Domain: no se inyecta directamente (clases puras)
 *   - Application: UseCases registrados como providers
 *   - Infrastructure: adapters concretos (PrismaTenantRepository)
 *   - Interface: controllers REST
 *
 * El binding crítico es: TENANT_REPOSITORY (port) → PrismaTenantRepository (adapter).
 * Cambiar el adapter (ej: a EventStore o In-Memory para tests) se hace
 * sustituyendo este único provider, sin tocar use cases ni dominio.
 */
const repositoryProviders: Provider[] = [
  PrismaTenantRepository,
  {
    provide: TENANT_REPOSITORY,
    useExisting: PrismaTenantRepository,
  },
  // Estado de acceso del tenant para el JwtAuthGuard (IAM lo consume por el port).
  PrismaTenantAccess,
  {
    provide: TENANT_ACCESS_PORT,
    useExisting: PrismaTenantAccess,
  },
];

const useCases: Provider[] = [
  CreateTenant,
  ActivateTenant,
  SuspendTenant,
  DeleteTenant,
  ChangePlan,
  RenameTenant,
  GetTenantById,
  GetTenantByCode,
  GetMyTenant,
  ListTenants,
];

@Module({
  controllers: [PlatformTenantsController, MyTenantController],
  providers: [...repositoryProviders, ...useCases],
  exports: [TENANT_REPOSITORY, TENANT_ACCESS_PORT, ...useCases],
})
export class TenantContextModule {}
