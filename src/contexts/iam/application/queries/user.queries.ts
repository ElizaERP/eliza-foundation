import { Inject, Injectable } from '@nestjs/common';

import {
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
  EmailAddress,
  KeycloakSubject,
  USER_REPOSITORY,
  UserErrors,
  UserId,
  UserRepository,
} from '../../domain';
import { UserView, toUserView } from '../dto/user.view';

// =====================================================================
// GetUserById
// =====================================================================
@Injectable()
export class GetUserById implements UseCase<{ userId: string }, UserView> {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(input: { userId: string }): Promise<Result<UserView, ApplicationError>> {
    const user = await this.users.findById(UserId.fromString(input.userId));
    if (!user) {
      const e = UserErrors.notFound(input.userId);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }
    return ok(toUserView(user));
  }
}

// =====================================================================
// GetMe — usuario autenticado (resuelve por keycloakSubject del JWT)
// =====================================================================
@Injectable()
export class GetMe implements UseCase<void, UserView> {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(): Promise<Result<UserView, ApplicationError>> {
    const sub = this.ctx.tryGetUserId();
    if (!sub) {
      return err(applicationError('iam.no_authenticated_user', 'No authenticated user in request', 'unauthorized'));
    }

    // El "userId" del CLS es el sub del JWT (Keycloak subject). Lo resolvemos.
    const subVO = KeycloakSubject.create(sub);
    if (subVO.isErr) {
      return err(applicationError(subVO.error.code, subVO.error.message, 'unauthorized'));
    }

    const user = await this.users.findByKeycloakSubject(subVO.value);
    if (!user) {
      const e = UserErrors.notFoundByKeycloakSubject(sub);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }
    return ok(toUserView(user));
  }
}

// =====================================================================
// GetUserByEmail
// =====================================================================
@Injectable()
export class GetUserByEmail implements UseCase<{ email: string }, UserView> {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(input: { email: string }): Promise<Result<UserView, ApplicationError>> {
    const emailR = EmailAddress.create(input.email);
    if (emailR.isErr) {
      return err(applicationError(emailR.error.code, emailR.error.message, 'validation', emailR.error.details));
    }
    const user = await this.users.findByEmail(emailR.value);
    if (!user) {
      const e = UserErrors.notFoundByEmail(input.email);
      return err(applicationError(e.code, e.message, 'not_found', e.details));
    }
    return ok(toUserView(user));
  }
}

// =====================================================================
// ListUsersInTenant
// =====================================================================
export interface ListUsersInput {
  tenantId: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListUsersOutput {
  items: UserView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class ListUsersInTenant implements UseCase<ListUsersInput, ListUsersOutput> {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(input: ListUsersInput): Promise<Result<ListUsersOutput, ApplicationError>> {
    const result = await this.users.listByTenant({
      tenantId: input.tenantId,
      page: input.page,
      pageSize: input.pageSize,
      search: input.search,
    });
    return ok({
      items: result.items.map(toUserView),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  }
}
