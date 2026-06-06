import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CLOCK_PORT,
  ClockPort,
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
  LOTE_REPOSITORY,
  Lote,
  LoteId,
  LoteRepository,
  OrigenLote,
} from '@eliza/contexts/inventory/domain';
import {
  PRODUCT_REPOSITORY,
  ProductRepository,
  ProductStatus,
} from '@eliza/contexts/catalog/domain';
import {
  LoteView,
  toLoteView,
} from '@eliza/contexts/inventory/application/dto/inventory.views';

// =====================================================================
// RegisterLot
// =====================================================================
export interface RegisterLotInput {
  codigoLote: string;
  productId: string;
  fechaProduccion: Date;
  fechaVencimiento: Date;
  cantidadInicial: number;
  origenTipo: OrigenLote;
  origenRef?: string;
  notas?: string;
}

@Injectable()
export class RegisterLotUseCase implements UseCase<RegisterLotInput, LoteView> {
  private readonly logger = new Logger(RegisterLotUseCase.name);

  constructor(
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: ProductRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: RegisterLotInput): Promise<Result<LoteView, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const now = this.clock.now();

    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      return err(applicationError('inventory.product_not_found',
        `Product ${input.productId} not found`, 'not_found'));
    }
    if (product.status === ProductStatus.Discontinued) {
      return err(applicationError('inventory.product_discontinued',
        `Cannot register lot for discontinued product ${input.productId}`, 'validation'));
    }

    const existing = await this.loteRepo.findByCodigoLote(input.productId, input.codigoLote);
    if (existing) {
      return err(applicationError('inventory.lote_code_exists',
        `Lote with code ${input.codigoLote} already exists for this product`, 'conflict'));
    }

    const loteR = Lote.create({
      tenantId,
      codigoLote: input.codigoLote,
      productId: input.productId,
      fechaProduccion: input.fechaProduccion,
      fechaVencimiento: input.fechaVencimiento,
      cantidadInicial: input.cantidadInicial,
      origenTipo: input.origenTipo,
      origenRef: input.origenRef,
      notas: input.notas,
      now,
    });
    if (loteR.isErr) {
      return err(applicationError(loteR.error.code, loteR.error.message, 'validation'));
    }

    await this.loteRepo.save(loteR.value);
    this.logger.log(`Lote ${loteR.value.codigoLote} registered for product ${input.productId}`);
    return ok(toLoteView(loteR.value, now));
  }
}

// =====================================================================
// BlockLot
// =====================================================================
export interface BlockLotInput { loteId: string; reason: string; }

@Injectable()
export class BlockLotUseCase implements UseCase<BlockLotInput, LoteView> {
  constructor(
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: BlockLotInput): Promise<Result<LoteView, ApplicationError>> {
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const lote = await this.loteRepo.findById(LoteId.fromString(input.loteId));
    if (!lote) {
      return err(applicationError('inventory.lote_not_found',
        `Lote ${input.loteId} not found`, 'not_found'));
    }

    const blockR = lote.block({ reason: input.reason, blockedBy: userId, now });
    if (blockR.isErr) {
      return err(applicationError(blockR.error.code, blockR.error.message, 'validation'));
    }

    await this.loteRepo.save(lote);
    return ok(toLoteView(lote, now));
  }
}

// =====================================================================
// ReleaseLot
// =====================================================================
export interface ReleaseLotInput { loteId: string; }

@Injectable()
export class ReleaseLotUseCase implements UseCase<ReleaseLotInput, LoteView> {
  constructor(
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: ReleaseLotInput): Promise<Result<LoteView, ApplicationError>> {
    const userId = this.ctx.tryGetUserId() ?? 'system';
    const now = this.clock.now();

    const lote = await this.loteRepo.findById(LoteId.fromString(input.loteId));
    if (!lote) {
      return err(applicationError('inventory.lote_not_found',
        `Lote ${input.loteId} not found`, 'not_found'));
    }

    const r = lote.release({ releasedBy: userId, now });
    if (r.isErr) {
      return err(applicationError(r.error.code, r.error.message, 'validation'));
    }

    await this.loteRepo.save(lote);
    return ok(toLoteView(lote, now));
  }
}

// =====================================================================
// GetLotById
// =====================================================================
@Injectable()
export class GetLotByIdUseCase implements UseCase<{ loteId: string }, LoteView | null> {
  constructor(
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: { loteId: string }): Promise<Result<LoteView | null, ApplicationError>> {
    const lote = await this.loteRepo.findById(LoteId.fromString(input.loteId));
    if (!lote) return ok(null);
    return ok(toLoteView(lote, this.clock.now()));
  }
}

// =====================================================================
// ListExpiringLots
// =====================================================================
export interface ListExpiringLotsInput { withinDays: number; limit?: number; }

@Injectable()
export class ListExpiringLotsUseCase implements UseCase<ListExpiringLotsInput, LoteView[]> {
  constructor(
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: ListExpiringLotsInput): Promise<Result<LoteView[], ApplicationError>> {
    const now = this.clock.now();
    const threshold = new Date(now.getTime() + input.withinDays * 24 * 60 * 60 * 1000);
    const lotes = await this.loteRepo.findExpiringBefore(threshold, input.limit ?? 100);
    return ok(lotes.map((l: Lote) => toLoteView(l, now)));
  }
}

// =====================================================================
// ListLotsByProduct
// =====================================================================
export interface ListLotsByProductInput { productId: string; limit?: number; offset?: number; }

@Injectable()
export class ListLotsByProductUseCase implements UseCase<ListLotsByProductInput, LoteView[]> {
  constructor(
    @Inject(LOTE_REPOSITORY) private readonly loteRepo: LoteRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  async execute(input: ListLotsByProductInput): Promise<Result<LoteView[], ApplicationError>> {
    const lotes = await this.loteRepo.findByProduct(
      input.productId, input.limit ?? 50, input.offset ?? 0,
    );
    const now = this.clock.now();
    return ok(lotes.map((l: Lote) => toLoteView(l, now)));
  }
}
