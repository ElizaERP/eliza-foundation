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
  LOCATION_REPOSITORY,
  LocationId,
  LocationRepository,
  OrigenLote,
  TipoReferencia,
} from '@eliza/contexts/inventory/domain';
import {
  ExistenciaView,
  LoteView,
} from '@eliza/contexts/inventory/application/dto/inventory.views';
import { RegisterLotUseCase } from '@eliza/contexts/inventory/application/lote.use-cases';
import { ReceiveInventoryUseCase } from '@eliza/contexts/inventory/application/existencia.use-cases';

// =====================================================================
// RegisterReceipt — "Recibir mercancía" (Sprint 13)
// =====================================================================
/**
 * Entrada de mercancía en un solo paso: crea el lote y lo ingresa al
 * inventario en la ubicación elegida.
 *
 * Antes eran dos llamadas (POST /lots y POST /stock/receive): si la segunda
 * fallaba quedaba un lote huérfano con el código ocupado. Aquí se valida la
 * ubicación ANTES de crear el lote; las demás validaciones (producto activo,
 * código único, fechas, cantidad) las hace RegisterLot sin escribir nada si
 * fallan. Con eso, la entrada solo puede fallar después de crear el lote por
 * un error de infraestructura.
 *
 * Origen:
 *   - Purchase: compra a proveedor. `documento` = factura o remisión.
 *     Movimiento con referencia PurchaseOrder:<documento>.
 *   - Manual: carga inicial o hallazgo. `documento` = una descripción corta.
 *     Movimiento con referencia Manual:<documento>.
 * Los lotes de producción NO entran por aquí: los crea la orden de producción.
 */
export interface RegisterReceiptInput {
  productId: string;
  codigoLote: string;
  cantidad: number;
  locationId: string;
  fechaVencimiento: Date;
  /** Por defecto: ahora. */
  fechaProduccion?: Date;
  origenTipo: OrigenLote.Purchase | OrigenLote.Manual;
  documento: string;
  notas?: string;
}

export interface RegisterReceiptOutput {
  lote: LoteView;
  existencia: ExistenciaView;
  movimientoId: string;
}

@Injectable()
export class RegisterReceiptUseCase implements UseCase<RegisterReceiptInput, RegisterReceiptOutput> {
  private readonly logger = new Logger(RegisterReceiptUseCase.name);

  constructor(
    private readonly registerLot: RegisterLotUseCase,
    private readonly receive: ReceiveInventoryUseCase,
    @Inject(LOCATION_REPOSITORY) private readonly locationRepo: LocationRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  async execute(input: RegisterReceiptInput): Promise<Result<RegisterReceiptOutput, ApplicationError>> {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) throw new Error('Tenant context required');
    const now = this.clock.now();

    if (input.origenTipo !== OrigenLote.Purchase && input.origenTipo !== OrigenLote.Manual) {
      return err(applicationError('inventory.receipt_origin_invalid',
        'Las entradas son de compra o manuales; los lotes de producción los registra la orden.', 'validation'));
    }
    const documento = (input.documento ?? '').trim();
    if (documento.length === 0) {
      return err(applicationError('inventory.receipt_document_required',
        input.origenTipo === OrigenLote.Purchase
          ? 'Escribe el número de la factura o remisión del proveedor.'
          : 'Escribe una referencia para la entrada (p. ej. "Inventario inicial").',
        'validation'));
    }

    // 1. Ubicación primero: es lo único que ReceiveInventory valida y RegisterLot no.
    const location = await this.locationRepo.findById(LocationId.fromString(input.locationId));
    if (!location) {
      return err(applicationError('inventory.location_not_found', 'La ubicación no existe.', 'not_found'));
    }
    if (!location.isActive) {
      return err(applicationError('inventory.location_inactive', 'La ubicación está inactiva.', 'validation'));
    }

    // 2. Lote (valida producto, código único, fechas y cantidad sin escribir si falla)
    const loteR = await this.registerLot.execute({
      codigoLote: input.codigoLote,
      productId: input.productId,
      fechaProduccion: input.fechaProduccion ?? now,
      fechaVencimiento: input.fechaVencimiento,
      cantidadInicial: input.cantidad,
      origenTipo: input.origenTipo,
      origenRef: documento,
      notas: input.notas,
    });
    if (loteR.isErr) return err(loteR.error);
    const lote = loteR.value;

    // 3. Ingreso al inventario
    const recR = await this.receive.execute({
      productId: input.productId,
      loteId: lote.id,
      locationId: input.locationId,
      cantidad: input.cantidad,
      referenciaTipo: input.origenTipo === OrigenLote.Purchase ? TipoReferencia.PurchaseOrder : TipoReferencia.Manual,
      referenciaId: documento,
    });
    if (recR.isErr) {
      this.logger.error(`Lote ${lote.codigoLote} (${lote.id}) creado pero la entrada falló: ${recR.error.code}`);
      return err(applicationError(recR.error.code,
        `Se creó el lote ${lote.codigoLote} pero no se pudo ingresar al inventario: ${recR.error.message}`,
        recR.error.category, { loteId: lote.id, ...(recR.error.details ?? {}) }));
    }

    this.logger.log(`Entrada ${lote.codigoLote}: ${input.cantidad} de ${input.productId} (${input.origenTipo}:${documento})`);
    return ok({ lote, existencia: recR.value.existencia, movimientoId: recR.value.movimientoId });
  }
}
