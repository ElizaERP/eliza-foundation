import { Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import {
  ActivateUser,
  AssignRole,
  CreateUser,
  DeleteUser,
  GetMe,
  GetUserByEmail,
  GetUserById,
  GrantMembership,
  ListUsersInTenant,
  RevokeMembership,
  RevokeRole,
  SuspendUser,
} from './application';
import { IDENTITY_PROVIDER_PORT, USER_REPOSITORY } from './domain';
import {
  JwtAuthGuard,
  RolesGuard,
} from './infrastructure/auth/auth.guards';
import { JwksService } from './infrastructure/auth/jwks.service';
import { JwtStrategy } from './infrastructure/auth/jwt.strategy';
import { KeycloakAdminClient } from './infrastructure/keycloak/keycloak-admin.client';
import { KeycloakConfig } from './infrastructure/keycloak/keycloak.config';
import { KeycloakIdentityProvider } from './infrastructure/keycloak/keycloak-identity-provider';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { MeController } from './interface/http/me.controller';
import {
  PlatformUsersController,
  TenantUsersController,
} from './interface/http/users.controllers';

const portBindings: Provider[] = [
  PrismaUserRepository,
  { provide: USER_REPOSITORY, useExisting: PrismaUserRepository },

  KeycloakIdentityProvider,
  { provide: IDENTITY_PROVIDER_PORT, useExisting: KeycloakIdentityProvider },
];

const keycloakInfrastructure: Provider[] = [
  KeycloakConfig,
  KeycloakAdminClient,
  JwksService,
  JwtStrategy,
];

const useCases: Provider[] = [
  CreateUser,
  ActivateUser,
  SuspendUser,
  DeleteUser,
  GrantMembership,
  RevokeMembership,
  AssignRole,
  RevokeRole,
  GetUserById,
  GetUserByEmail,
  GetMe,
  ListUsersInTenant,
];

const globalGuards: Provider[] = [
  // Orden: primero JwtAuthGuard (valida token), después RolesGuard
  // (lee @RequireRoles). Nest los ejecuta en el orden declarado.
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'eliza-jwt' }),
  ],
  controllers: [
    MeController,
    PlatformUsersController,
    TenantUsersController,
  ],
  providers: [
    ...keycloakInfrastructure,
    ...portBindings,
    ...useCases,
    ...globalGuards,
  ],
  exports: [
    USER_REPOSITORY,
    IDENTITY_PROVIDER_PORT,
    KeycloakConfig,
    JwksService,
    ...useCases,
  ],
})
export class IamContextModule {}
