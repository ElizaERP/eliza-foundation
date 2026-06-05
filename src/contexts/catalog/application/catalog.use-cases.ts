import { Inject, Injectable } from '@nestjs/common';

import { CLOCK_PORT, ClockPort, TENANT_CONTEXT_PORT, TenantContextPort } from '@eliza/shared-kernel/application/ports';
import { ApplicationError, UseCase, applicationError } from '@eliza/shared-kernel/application/use-case';
import { Result, err, ok } from '@eliza/shared-kernel/domain';

import {
  CATEGORY_REPOSITORY,
  Category,
  CategoryRepository,
  UNIT_OF_MEASURE_REPOSITORY,
  UnitOfMeasureRepository,
} from '@eliza/contexts/catalog/domain';
import { CategoryView, UnitOfMeasureView, toCategoryView, toUomView } from '@eliza/contexts/catalog/application/dto/catalog.views';

// =====================================================================
// CreateCategory
// =====================================================================
export interface CreateCategoryInput {
  code: string;
  name: string;
  description?: string;
  parentId?: string;
}

@Injectable()
export class CreateCategory implements UseCase<CreateCategoryInput, CategoryView> {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: CreateCategoryInput): Promise<Result<CategoryView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('catalog.no_tenant', 'Tenant context required', 'unauthorized'));
    }

    const existing = await this.categories.findByCode(input.code);
    if (existing) {
      return err(applicationError('category.code_already_exists',
        `Category code '${input.code}' already exists`, 'conflict'));
    }

    let parent: Category | undefined;
    if (input.parentId) {
      const p = await this.categories.findById(input.parentId);
      if (!p) {
        return err(applicationError('category.parent_not_found',
          `Parent category '${input.parentId}' not found`, 'not_found'));
      }
      if (!p.isActive) {
        return err(applicationError('category.parent_inactive',
          'Cannot create child of an inactive category', 'validation'));
      }
      parent = p;
    }

    const r = Category.create({
      tenantId,
      code: input.code,
      name: input.name,
      description: input.description,
      parent,
      now: this.clock.now(),
    });
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'validation', r.error.details));

    await this.categories.save(r.value);
    return ok(toCategoryView(r.value));
  }
}

// =====================================================================
// ListCategories — devuelve árbol completo del tenant
// =====================================================================
export interface CategoryTreeNode extends CategoryView {
  children: CategoryTreeNode[];
}

@Injectable()
export class ListCategoryTree implements UseCase<{ activeOnly?: boolean }, CategoryTreeNode[]> {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: { activeOnly?: boolean }): Promise<Result<CategoryTreeNode[], ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) {
      return err(applicationError('catalog.no_tenant', 'Tenant context required', 'unauthorized'));
    }

    const all = await this.categories.listAll({ tenantId, activeOnly: input.activeOnly });
    // Construir árbol
    const byId = new Map<string, CategoryTreeNode>();
    for (const c of all) {
      byId.set(c.id.value, { ...toCategoryView(c), children: [] });
    }
    const roots: CategoryTreeNode[] = [];
    for (const c of all) {
      const node = byId.get(c.id.value)!;
      if (c.parentId) {
        const parent = byId.get(c.parentId.value);
        if (parent) parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return ok(roots);
  }
}

@Injectable()
export class GetCategoryById implements UseCase<{ categoryId: string }, CategoryView> {
  constructor(@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository) {}

  async execute(input: { categoryId: string }) {
    const c = await this.categories.findById(input.categoryId);
    if (!c) return err(applicationError('category.not_found', `Category not found`, 'not_found'));
    return ok<CategoryView, ApplicationError>(toCategoryView(c));
  }
}

@Injectable()
export class RenameCategory
  implements UseCase<{ categoryId: string; newName: string; expectedVersion?: number }, CategoryView>
{
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { categoryId: string; newName: string; expectedVersion?: number }) {
    const c = await this.categories.findById(input.categoryId);
    if (!c) return err(applicationError('category.not_found', `Category not found`, 'not_found'));
    const r = c.rename(input.newName, this.clock.now());
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));
    await this.categories.save(c, input.expectedVersion);
    return ok<CategoryView, ApplicationError>(toCategoryView(c));
  }
}

@Injectable()
export class DeactivateCategory
  implements UseCase<{ categoryId: string; reason: string; expectedVersion?: number }, CategoryView>
{
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { categoryId: string; reason: string; expectedVersion?: number }) {
    const c = await this.categories.findById(input.categoryId);
    if (!c) return err(applicationError('category.not_found', `Category not found`, 'not_found'));
    const r = c.deactivate(input.reason, this.clock.now());
    if (r.isErr) return err(applicationError(r.error.code, r.error.message, 'domain'));
    await this.categories.save(c, input.expectedVersion);
    return ok<CategoryView, ApplicationError>(toCategoryView(c));
  }
}

// =====================================================================
// UnitOfMeasure queries (read-only por tenant; gestión queda a Platform)
// =====================================================================
@Injectable()
export class ListUnitsOfMeasure
  implements UseCase<{ dimension?: string; activeOnly?: boolean }, UnitOfMeasureView[]>
{
  constructor(@Inject(UNIT_OF_MEASURE_REPOSITORY) private readonly uoms: UnitOfMeasureRepository) {}

  async execute(input: { dimension?: string; activeOnly?: boolean }) {
    const items = await this.uoms.listAll(input);
    return ok<UnitOfMeasureView[], ApplicationError>(items.map(toUomView));
  }
}
