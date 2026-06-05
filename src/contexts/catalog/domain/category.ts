import { AggregateRoot, DomainError, Result, err, ok } from '@eliza/shared-kernel/domain';

import { CategoryCreated, CategoryDeactivated, CategoryRenamed } from './catalog-events';
import { CategoryId, EntityName } from './value-objects';

interface CategoryProps {
  code: string;
  name: EntityName;
  description: string | null;
  tenantId: string;
  parentId: CategoryId | null;
  path: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Category extends AggregateRoot<CategoryId, CategoryProps> {
  private constructor(id: CategoryId, props: CategoryProps, version: number) {
    super(id, props, version);
  }

  get tenantId(): string { return this.props.tenantId; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name.value; }
  get description(): string | null { return this.props.description; }
  get parentId(): CategoryId | null { return this.props.parentId; }
  get path(): string { return this.props.path; }
  get isActive(): boolean { return this.props.isActive; }
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
    const path = args.parent ? `${args.parent.path}/${args.code}` : `/${args.code}`;

    const category = new Category(id, {
      code: args.code,
      name: nameR.value,
      description: args.description?.trim() || null,
      tenantId: args.tenantId,
      parentId: args.parent?.id ?? null,
      path,
      isActive: true,
      createdAt: args.now,
      updatedAt: args.now,
    }, 1);

    category.addDomainEvent(new CategoryCreated({
      categoryId: id.value,
      tenantId: args.tenantId,
      code: args.code,
      name: nameR.value.value,
      parentId: args.parent?.id.value ?? null,
      path,
    }));

    return ok(category);
  }

  rename(newName: string, now: Date): Result<void, DomainError> {
    const nameR = EntityName.create(newName, 'categoryName');
    if (nameR.isErr) return err(nameR.error);
    if (nameR.value.value === this.props.name.value) return ok(undefined);

    const oldName = this.props.name.value;
    this.props = { ...this.props, name: nameR.value, updatedAt: now };
    this.incrementVersion();

    this.addDomainEvent(new CategoryRenamed({
      categoryId: this._id.value,
      tenantId: this.props.tenantId,
      oldName,
      newName: nameR.value.value,
    }));
    return ok(undefined);
  }

  deactivate(reason: string, now: Date): Result<void, DomainError> {
    if (!this.props.isActive) {
      return err({ code: 'category.already_inactive', message: 'Category is already inactive' });
    }
    this.props = { ...this.props, isActive: false, updatedAt: now };
    this.incrementVersion();

    this.addDomainEvent(new CategoryDeactivated({
      categoryId: this._id.value,
      tenantId: this.props.tenantId,
      reason,
    }));
    return ok(undefined);
  }

  static reconstitute(args: {
    id: CategoryId;
    tenantId: string;
    code: string;
    name: EntityName;
    description: string | null;
    parentId: CategoryId | null;
    path: string;
    isActive: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Category {
    return new Category(args.id, {
      code: args.code,
      name: args.name,
      description: args.description,
      tenantId: args.tenantId,
      parentId: args.parentId,
      path: args.path,
      isActive: args.isActive,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    }, args.version);
  }
}
