import { Inject, Injectable } from '@nestjs/common';

import {
  ApplicationError,
  UseCase,
  applicationError,
} from '@eliza/shared-kernel/application/use-case';
import { Result, ok } from '@eliza/shared-kernel/domain';
import {
  MOVIMIENTO_REPOSITORY,
  MovimientoRepository,
  TipoMovimiento,
} from '@eliza/contexts/inventory/domain';
import {
  MovimientoView,
  toMovimientoView,
} from '@eliza/contexts/inventory/application/dto/inventory.views';

// =====================================================================
// GetMovementHistory — kardex paginado
// =====================================================================
export interface GetMovementHistoryInput {
  productId?: string;
  loteId?: string;
  locationId?: string;
  tipo?: TipoMovimiento;
  ocurridoDesde?: Date;
  ocurridoHasta?: Date;
  referenciaId?: string;
  limit?: number;
  offset?: number;
}

export interface GetMovementHistoryOutput {
  items: MovimientoView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class GetMovementHistoryUseCase
  implements UseCase<GetMovementHistoryInput, GetMovementHistoryOutput>
{
  constructor(
    @Inject(MOVIMIENTO_REPOSITORY) private readonly movimientoRepo: MovimientoRepository,
  ) {}

  async execute(input: GetMovementHistoryInput): Promise<Result<GetMovementHistoryOutput, ApplicationError>> {
    const filter = {
      productId: input.productId,
      loteId: input.loteId,
      locationId: input.locationId,
      tipo: input.tipo,
      ocurridoDesde: input.ocurridoDesde,
      ocurridoHasta: input.ocurridoHasta,
      referenciaId: input.referenciaId,
      limit: Math.min(input.limit ?? 50, 200),
      offset: input.offset ?? 0,
    };
    const [items, total] = await Promise.all([
      this.movimientoRepo.query(filter),
      this.movimientoRepo.countBy(filter),
    ]);
    return ok({
      items: items.map(toMovimientoView),
      total,
      limit: filter.limit,
      offset: filter.offset,
    });
  }
}
