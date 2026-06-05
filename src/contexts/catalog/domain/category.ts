import { AggregateRoot, DomainError, DomainEvent, Result, err, ok } from '@eliza/shared-kernel/domain';

import { CategoryId, EntityName } from './value-objects';

interface CategoryProps {
  id: CategoryId;
  tenantId: string;
  code: string;
  name: EntityName;
  description: string | null;
  parentId: CategoryId | null;
  path: string;       // materializado: "/congelados/arepas/mini"
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------- Domain Events ----------
export interface CategoryCreatedPayload {
  categoryId: string;
  code: string;
  name: string;
  parentId: string | null;
  path: string;
}

export interface CategoryRenamedPayload {
  categoryId: string;
  oldName: string;
  newName: string;
}

export interface CategoryDeactivatedPayload {
  categoryId: string;
  reason: string;
}

/**
 * Category — categorías de productos por tenant, jerarquía en forma de
 * árbol. El "path" es materializado para queries eficientes:
 *   "/congelados/arepas/mini"
 * Esto permite listar todos los descendientes con un LIKE 'path%'.
 */
export class Category extends AggregateRoot<CategoryProps> {
  private constructor(props: CategoryProps) { super(props); }

  get id(): CategoryId { return this.props.id; }
  get tenantId(): string { return this.props.tenantId; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name.value; }
  get description(): string | null { return this.props.description; }
  get parentId(): CategoryId | null { return this.props.parentId; }
  get path(): string { return this.props.path; }
  get isActive(): boolean { return this.props.isActive; }
  get version(): number { return this.props.version; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  static create(args: {
    tenantId: string;
    code: string;
    name: string;
    description?: string;
    parent?: Category;
    now: Date;
  }): Result<Category, DomainError> {
    const nameR = EntityName.create(args.name, 'categoryName');
    if (nameR.isErr) return err(nameR.error);

    if (!/^[a-z0-9-]+$/.test(args.code) || args.code.length < 2 || args.code.length > 50) {
      return err({ code: 'category.code_invalid', message: 'Category code must be lowercase, alphanumeric, 2-50 chars' });
    }

    const id = CategoryId.generate();
    const path = args.parent
      ? `${args.parent.path}/${args.code}`
      : `/${args.code}`;

    const category = new Category({
      id,
      tenantId: args.tenantId,
      code: args.code,
      name: nameR.value,
      description: args.description?.trim() || null,
      parentId: args.parent?.id ?? null,
      path,
      isActive: true,
      version: 1,
      createdAt: args.now,
      updatedAt: args.now,
    });

    category.addDomainEvent<CategoryCreatedPayload>({
      type: 'catalog.CategoryCreated.v1',
      aggregateType: 'Category',
      aggregateId: id.value,
      tenantId: args.tenantId,
      payload: {
        categoryId: id.value,
        code: args.code,
        name: nameR.value.value,
        parentId: args.parent?.id.value ?? null,
        path,
      },
      occurredAt: args.now,
      version: 1,
    });

    return ok(category);
  }

  rename(newName: string, now: Date): Result<void, DomainError> {
    const nameR = EntityName.create(newName, 'categoryName');
    if (nameR.isErr) return err(nameR.error);
    if (nameR.value.value === this.props.name.value) {
      return ok(undefined); // no-op
    }
    const oldName = this.props.name.value;
    this.props.name = nameR.value;
    this.props.updatedAt = now;
    this.incrementVersion();

    this.addDomainEvent<CategoryRenamedPayload>({
      type: 'catalog.CategoryRenamed.v1',
      aggregateType: 'Category',
      aggregateId: this.props.id.value,
      tenantId: this.props.tenantId,
      payload: { categoryId: this.props.id.value, oldName, newName: nameR.value.value },
      occurredAt: now,
      version: 1,
    });
    return ok(undefined);
  }

  deactivate(reason: string, now: Date): Result<void, DomainError> {
    if (!this.props.isActive) {
      return err({ code: 'category.already_inactive', message: 'Category is already inactive' });
    }
    this.props.isActive = false;
    this.props.updatedAt = now;
    this.incrementVersion();

    this.addDomainEvent<CategoryDeactivatedPayload>({
      type: 'catalog.CategoryDeactivated.v1',
      aggregateType: 'Category',
      aggregateId: this.props.id.value,
      tenantId: this.props.tenantId,
      payload: { categoryId: this.props.id.value, reason },
      occurredAt: now,
      version: 1,
    });
    return ok(undefined);
  }

  static reconstitute(props: CategoryProps): Category {
    return new Category(props);
  }
}
