import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';

import {
  GetEntityHistory,
  QueryAudit,
  VerifyHashChain,
} from '../../application';
import {
  SkipAudit,
} from '../../infrastructure/interceptors/audit.interceptor';
import {
  AuditEntryResponse,
  AuditQueryResponse,
  EntityHistoryParam,
  QueryAuditRequest,
  VerifyChainQuery,
  VerifyChainResponse,
} from './dto/audit.dto';

function unwrap<T>(result: Result<T, ApplicationError>): T {
  if (result.isErr) throw result.error;
  return result.value;
}

/**
 * Endpoints de consulta del audit trail.
 *
 * Lectura: cualquier usuario autenticado puede consultar SU PROPIO tenant.
 * El TenantContextPort enfuerza el filtro — un usuario nunca puede ver
 * audit de otro tenant.
 *
 * @SkipAudit() porque las CONSULTAS no se auditan a sí mismas (sería
 * un loop infinito de auditoría que crece exponencialmente).
 */
@ApiTags('Audit')
@ApiBearerAuth()
@RequireRoles('Tenant.Admin', 'Tenant.Viewer', 'Platform.Admin', 'Platform.Support')
@SkipAudit()
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(
    private readonly queryAudit: QueryAudit,
    private readonly getEntityHistory: GetEntityHistory,
    private readonly verifyHashChain: VerifyHashChain,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar entradas del audit log con filtros',
    description:
      'Devuelve entradas del tenant del usuario autenticado. Soporta ' +
      'filtros por usuario, acción, tipo de entidad, rango de fechas y correlationId.',
  })
  @ApiOkResponse({ type: AuditQueryResponse })
  async query(@Query() q: QueryAuditRequest): Promise<AuditQueryResponse> {
    return unwrap(await this.queryAudit.execute(q)) as AuditQueryResponse;
  }

  @Get('entity/:entityType/:entityId')
  @ApiOperation({
    summary: 'Historial completo de una entidad',
    description: 'Todos los eventos auditados para entityType/entityId, en orden cronológico inverso.',
  })
  @ApiOkResponse({ type: [AuditEntryResponse] })
  async entityHistory(@Param() params: EntityHistoryParam): Promise<AuditEntryResponse[]> {
    return unwrap(await this.getEntityHistory.execute({
      entityType: params.entityType,
      entityId: params.entityId,
    })) as AuditEntryResponse[];
  }

  @Get('verify-chain')
  @ApiOperation({
    summary: 'Verificar integridad criptográfica del audit chain',
    description:
      'Recorre la cadena del tenant y valida que cada hash es correcto y ' +
      'que cada previousHash apunta correctamente al anterior. Devuelve ' +
      'isValid=true si la cadena no ha sido tampered.',
  })
  @ApiOkResponse({ type: VerifyChainResponse })
  async verify(@Query() q: VerifyChainQuery): Promise<VerifyChainResponse> {
    const result = unwrap(await this.verifyHashChain.execute({
      fromChainIndex: q.fromChainIndex,
      toChainIndex: q.toChainIndex,
    }));
    return {
      tenantId: result.tenantId,
      entriesChecked: result.entriesChecked,
      isValid: result.isValid,
      firstBrokenChainIndex: result.firstBrokenChainIndex?.toString() ?? null,
      brokenReason: result.brokenReason,
    };
  }
}
