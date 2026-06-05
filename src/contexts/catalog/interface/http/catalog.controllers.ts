import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';

import {
  ActivateProduct,
  CreateCategory,
  CreateProduct,
  DeactivateCategory,
  DiscontinueProduct,
  GetCategoryById,
  GetProductByCode,
  GetProductById,
  ListCategoryTree,
  ListProducts,
  ListUnitsOfMeasure,
  RenameCategory,
  RenameProduct,
  SearchProducts,
  SetBOM,
} from '../../application';
import {
  CategoryResponse,
  CategoryTreeResponse,
  CreateCategoryRequest,
  CreateProductRequest,
  DeactivateCategoryRequest,
  DiscontinueProductRequest,
  ListProductsQuery,
  ListProductsResponse,
  ProductResponse,
  RenameCategoryRequest,
  RenameProductRequest,
  SearchProductsQuery,
  SetBOMRequest,
  UnitOfMeasureResponse,
  VersionedAction,
} from './dto/catalog.dto';

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isErr) throw r.error;
  return r.value;
}

const READER_ROLES = ['Tenant.Admin', 'Tenant.Viewer', 'Manufacturing.Manager', 'Manufacturing.Supervisor',
  'Inventory.Manager', 'Sales.Manager', 'Sales.Salesperson', 'Quality.Manager', 'Quality.Inspector',
  'Procurement.Manager', 'Procurement.Buyer', 'Platform.Admin', 'Platform.Support'];

const WRITER_ROLES = ['Tenant.Admin', 'Manufacturing.Manager', 'Inventory.Manager', 'Platform.Admin'];

// =====================================================================
// Products
// =====================================================================
@ApiTags('Catalog · Products')
@ApiBearerAuth()
@Controller({ path: 'catalog/products', version: '1' })
export class ProductsController {
  constructor(
    private readonly create: CreateProduct,
    private readonly activate: ActivateProduct,
    private readonly discontinue: DiscontinueProduct,
    private readonly rename: RenameProduct,
    private readonly setBom: SetBOM,
    private readonly getById: GetProductById,
    private readonly getByCode: GetProductByCode,
    private readonly list: ListProducts,
    private readonly search: SearchProducts,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Crear producto (queda en estado Draft)' })
  @ApiOkResponse({ type: ProductResponse, status: 201 })
  async createProduct(@Body() body: CreateProductRequest): Promise<ProductResponse> {
    return unwrap(await this.create.execute(body)) as ProductResponse;
  }

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Listar productos con filtros' })
  @ApiOkResponse({ type: ListProductsResponse })
  async listProducts(@Query() q: ListProductsQuery): Promise<ListProductsResponse> {
    return unwrap(await this.list.execute(q)) as ListProductsResponse;
  }

  @Get('search')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Búsqueda full-text en name/code/sku/barcode' })
  @ApiOkResponse({ type: [ProductResponse] })
  async searchProducts(@Query() q: SearchProductsQuery): Promise<ProductResponse[]> {
    return unwrap(await this.search.execute({ q: q.q, limit: q.limit })) as ProductResponse[];
  }

  @Get('by-code/:code')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Resolver producto por code' })
  @ApiOkResponse({ type: ProductResponse })
  async byCode(@Param('code') code: string): Promise<ProductResponse> {
    return unwrap(await this.getByCode.execute({ code })) as ProductResponse;
  }

  @Get(':id')
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Resolver producto por ID' })
  @ApiOkResponse({ type: ProductResponse })
  async byId(@Param('id', ParseUUIDPipe) id: string): Promise<ProductResponse> {
    return unwrap(await this.getById.execute({ productId: id })) as ProductResponse;
  }

  @Patch(':id/rename')
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Renombrar producto' })
  @ApiOkResponse({ type: ProductResponse })
  async renameProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameProductRequest,
  ): Promise<ProductResponse> {
    return unwrap(await this.rename.execute({
      productId: id, newName: body.newName, expectedVersion: body.expectedVersion,
    })) as ProductResponse;
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Activar producto (Draft → Active)' })
  @ApiOkResponse({ type: ProductResponse })
  async activateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VersionedAction,
  ): Promise<ProductResponse> {
    return unwrap(await this.activate.execute({
      productId: id, expectedVersion: body?.expectedVersion,
    })) as ProductResponse;
  }

  @Post(':id/discontinue')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Descontinuar producto (terminal)' })
  @ApiOkResponse({ type: ProductResponse })
  async discontinueProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DiscontinueProductRequest,
  ): Promise<ProductResponse> {
    return unwrap(await this.discontinue.execute({
      productId: id, reason: body.reason, expectedVersion: body.expectedVersion,
    })) as ProductResponse;
  }

  @Put(':id/bom')
  @HttpCode(HttpStatus.OK)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({
    summary: 'Definir/reemplazar el BOM completo del producto',
    description: 'PUT reemplaza COMPLETAMENTE la lista de componentes. Para agregar uno, envía la lista entera.',
  })
  @ApiOkResponse({ type: ProductResponse })
  async setBOM(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetBOMRequest,
  ): Promise<ProductResponse> {
    return unwrap(await this.setBom.execute({
      productId: id, components: body.components, expectedVersion: body.expectedVersion,
    })) as ProductResponse;
  }
}

// =====================================================================
// Categories
// =====================================================================
@ApiTags('Catalog · Categories')
@ApiBearerAuth()
@Controller({ path: 'catalog/categories', version: '1' })
export class CategoriesController {
  constructor(
    private readonly create: CreateCategory,
    private readonly listTree: ListCategoryTree,
    private readonly getById: GetCategoryById,
    private readonly rename: RenameCategory,
    private readonly deactivate: DeactivateCategory,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Crear categoría' })
  @ApiOkResponse({ type: CategoryResponse, status: 201 })
  async createCategory(@Body() body: CreateCategoryRequest): Promise<CategoryResponse> {
    return unwrap(await this.create.execute(body)) as CategoryResponse;
  }

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({ summary: 'Listar el árbol completo de categorías del tenant' })
  @ApiOkResponse({ type: [CategoryTreeResponse] })
  async tree(@Query('activeOnly') activeOnly?: string): Promise<CategoryTreeResponse[]> {
    return unwrap(await this.listTree.execute({
      activeOnly: activeOnly === 'true',
    })) as CategoryTreeResponse[];
  }

  @Get(':id')
  @RequireRoles(...READER_ROLES)
  @ApiOkResponse({ type: CategoryResponse })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryResponse> {
    return unwrap(await this.getById.execute({ categoryId: id })) as CategoryResponse;
  }

  @Patch(':id/rename')
  @RequireRoles(...WRITER_ROLES)
  @ApiOkResponse({ type: CategoryResponse })
  async renameCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameCategoryRequest,
  ): Promise<CategoryResponse> {
    return unwrap(await this.rename.execute({
      categoryId: id, newName: body.newName, expectedVersion: body.expectedVersion,
    })) as CategoryResponse;
  }

  @Delete(':id')
  @RequireRoles(...WRITER_ROLES)
  @ApiOperation({ summary: 'Desactivar categoría (soft delete)' })
  @ApiOkResponse({ type: CategoryResponse })
  async deactivateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeactivateCategoryRequest,
  ): Promise<CategoryResponse> {
    return unwrap(await this.deactivate.execute({
      categoryId: id, reason: body.reason, expectedVersion: body.expectedVersion,
    })) as CategoryResponse;
  }
}

// =====================================================================
// Units of Measure (read-only por tenant)
// =====================================================================
@ApiTags('Catalog · Units of Measure')
@ApiBearerAuth()
@Controller({ path: 'catalog/units-of-measure', version: '1' })
export class UnitsOfMeasureController {
  constructor(private readonly listUoms: ListUnitsOfMeasure) {}

  @Get()
  @RequireRoles(...READER_ROLES)
  @ApiOperation({
    summary: 'Listar unidades de medida disponibles',
    description: 'Catálogo cross-tenant. Filtros opcionales por dimensión.',
  })
  @ApiOkResponse({ type: [UnitOfMeasureResponse] })
  async list(
    @Query('dimension') dimension?: string,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<UnitOfMeasureResponse[]> {
    return unwrap(await this.listUoms.execute({
      dimension,
      activeOnly: activeOnly === 'true',
    })) as UnitOfMeasureResponse[];
  }
}
