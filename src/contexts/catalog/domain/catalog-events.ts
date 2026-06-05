import { DomainEvent } from '@eliza/shared-kernel/domain';

// =====================================================================
// Category Events
// =====================================================================

interface CategoryCreatedArgs {
  categoryId: string;
  tenantId: string;
  code: string;
  name: string;
  parentId: string | null;
  path: string;
  correlationId?: string;
  userId?: string;
}

export class CategoryCreated extends DomainEvent {
  constructor(private readonly args: CategoryCreatedArgs) {
    super({
      eventType: 'catalog.CategoryCreated.v1',
      eventVersion: 1,
      aggregateType: 'Category',
      aggregateId: args.categoryId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      categoryId: this.args.categoryId,
      code: this.args.code,
      name: this.args.name,
      parentId: this.args.parentId,
      path: this.args.path,
    };
  }
}

interface CategoryRenamedArgs {
  categoryId: string;
  tenantId: string;
  oldName: string;
  newName: string;
  correlationId?: string;
  userId?: string;
}

export class CategoryRenamed extends DomainEvent {
  constructor(private readonly args: CategoryRenamedArgs) {
    super({
      eventType: 'catalog.CategoryRenamed.v1',
      eventVersion: 1,
      aggregateType: 'Category',
      aggregateId: args.categoryId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      categoryId: this.args.categoryId,
      oldName: this.args.oldName,
      newName: this.args.newName,
    };
  }
}

interface CategoryDeactivatedArgs {
  categoryId: string;
  tenantId: string;
  reason: string;
  correlationId?: string;
  userId?: string;
}

export class CategoryDeactivated extends DomainEvent {
  constructor(private readonly args: CategoryDeactivatedArgs) {
    super({
      eventType: 'catalog.CategoryDeactivated.v1',
      eventVersion: 1,
      aggregateType: 'Category',
      aggregateId: args.categoryId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return { categoryId: this.args.categoryId, reason: this.args.reason };
  }
}

// =====================================================================
// Product Events
// =====================================================================

interface ProductCreatedArgs {
  productId: string;
  tenantId: string;
  code: string;
  sku: string;
  name: string;
  type: string;
  categoryId: string;
  isControlled: boolean;
  correlationId?: string;
  userId?: string;
}

export class ProductCreated extends DomainEvent {
  constructor(private readonly args: ProductCreatedArgs) {
    super({
      eventType: 'catalog.ProductCreated.v1',
      eventVersion: 1,
      aggregateType: 'Product',
      aggregateId: args.productId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      productId: this.args.productId,
      code: this.args.code,
      sku: this.args.sku,
      name: this.args.name,
      type: this.args.type,
      categoryId: this.args.categoryId,
      isControlled: this.args.isControlled,
    };
  }
}

interface ProductActivatedArgs {
  productId: string;
  tenantId: string;
  code: string;
  sku: string;
  type: string;
  correlationId?: string;
  userId?: string;
}

export class ProductActivated extends DomainEvent {
  constructor(private readonly args: ProductActivatedArgs) {
    super({
      eventType: 'catalog.ProductActivated.v1',
      eventVersion: 1,
      aggregateType: 'Product',
      aggregateId: args.productId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      productId: this.args.productId,
      code: this.args.code,
      sku: this.args.sku,
      type: this.args.type,
    };
  }
}

interface ProductDiscontinuedArgs {
  productId: string;
  tenantId: string;
  reason: string;
  correlationId?: string;
  userId?: string;
}

export class ProductDiscontinued extends DomainEvent {
  constructor(private readonly args: ProductDiscontinuedArgs) {
    super({
      eventType: 'catalog.ProductDiscontinued.v1',
      eventVersion: 1,
      aggregateType: 'Product',
      aggregateId: args.productId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return { productId: this.args.productId, reason: this.args.reason };
  }
}

interface ProductUpdatedArgs {
  productId: string;
  tenantId: string;
  changes: string[];
  correlationId?: string;
  userId?: string;
}

export class ProductUpdated extends DomainEvent {
  constructor(private readonly args: ProductUpdatedArgs) {
    super({
      eventType: 'catalog.ProductUpdated.v1',
      eventVersion: 1,
      aggregateType: 'Product',
      aggregateId: args.productId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return { productId: this.args.productId, changes: this.args.changes };
  }
}

interface BOMUpdatedArgs {
  productId: string;
  tenantId: string;
  componentCount: number;
  totalQuantity: number;
  correlationId?: string;
  userId?: string;
}

export class BOMUpdated extends DomainEvent {
  constructor(private readonly args: BOMUpdatedArgs) {
    super({
      eventType: 'catalog.BOMUpdated.v1',
      eventVersion: 1,
      aggregateType: 'Product',
      aggregateId: args.productId,
      tenantId: args.tenantId,
      correlationId: args.correlationId,
      userId: args.userId,
    });
  }
  payload(): Record<string, unknown> {
    return {
      productId: this.args.productId,
      componentCount: this.args.componentCount,
      totalQuantity: this.args.totalQuantity,
    };
  }
}
