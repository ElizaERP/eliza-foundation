import { Module, Provider } from '@nestjs/common';

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
} from './application';
import {
  CATEGORY_REPOSITORY,
  PRODUCT_REPOSITORY,
  UNIT_OF_MEASURE_REPOSITORY,
} from './domain';
import {
  PrismaCategoryRepository,
  PrismaUnitOfMeasureRepository,
} from './infrastructure/persistence/prisma-catalog.repositories';
import { PrismaProductRepository } from './infrastructure/persistence/prisma-product.repository';
import {
  CategoriesController,
  ProductsController,
  UnitsOfMeasureController,
} from './interface/http/catalog.controllers';

const adapters: Provider[] = [
  PrismaProductRepository,
  { provide: PRODUCT_REPOSITORY, useExisting: PrismaProductRepository },

  PrismaCategoryRepository,
  { provide: CATEGORY_REPOSITORY, useExisting: PrismaCategoryRepository },

  PrismaUnitOfMeasureRepository,
  { provide: UNIT_OF_MEASURE_REPOSITORY, useExisting: PrismaUnitOfMeasureRepository },
];

const useCases: Provider[] = [
  CreateProduct,
  ActivateProduct,
  DiscontinueProduct,
  RenameProduct,
  SetBOM,
  GetProductById,
  GetProductByCode,
  ListProducts,
  SearchProducts,
  CreateCategory,
  RenameCategory,
  DeactivateCategory,
  GetCategoryById,
  ListCategoryTree,
  ListUnitsOfMeasure,
];

@Module({
  controllers: [ProductsController, CategoriesController, UnitsOfMeasureController],
  providers: [...adapters, ...useCases],
  exports: [
    PRODUCT_REPOSITORY,
    CATEGORY_REPOSITORY,
    UNIT_OF_MEASURE_REPOSITORY,
    ...useCases,
  ],
})
export class CatalogContextModule {}
