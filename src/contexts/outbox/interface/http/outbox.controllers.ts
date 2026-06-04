import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApplicationError } from '@eliza/shared-kernel/application/use-case';
import { Result } from '@eliza/shared-kernel/domain';
import { PrismaService } from '@eliza/shared-kernel/infrastructure/prisma/prisma.service';
import { RequireRoles } from '@eliza/shared-kernel/infrastructure/auth/auth.decorators';
import { SkipAudit } from '../../../audit/infrastructure/interceptors/audit.interceptor';

import {
  GetOutboxStats,
  ListDeadLetter,
  QueryOutbox,
  ReplayEvent,
} from '../../application';
import {
  EventIdParam,
  OutboxEntryResponse,
  OutboxQueryResponse,
  OutboxStatsResponse,
  QueryOutboxRequest,
  TenantSummaryResponse,
} from './dto/outbox.dto';

function unwrap<T>(r: Result<T, ApplicationError>): T {
  if (r.isErr) throw r.error;
  return r.value;
}

/**
 * Platform Outbox — monitoreo y administración del bus de eventos.
 *
 *   GET   /platform/outbox/stats                → métricas operativas
 *   GET   /platform/outbox/events               → buscar eventos (cualquier estado)
 *   GET   /platform/outbox/events/:id           → detalle
 *   POST  /platform/outbox/events/:id/replay    → re-encolar
 *   GET   /platform/outbox/dlq                  → lista DLQ
 *   POST  /platform/outbox/dlq/:id/retry        → retry desde DLQ
 *
 * Solo Platform.Admin y Platform.SRE — son operaciones de infraestructura.
 */
@ApiTags('Platform · Outbox')
@ApiBearerAuth()
@RequireRoles('Platform.Admin', 'Platform.SRE')
@SkipAudit()  // ver el audit log no se audita a sí mismo, igual para outbox
@Controller({ path: 'platform/outbox', version: '1' })
export class PlatformOutboxController {
  constructor(
    private readonly stats: GetOutboxStats,
    private readonly query: QueryOutbox,
    private readonly dlq: ListDeadLetter,
    private readonly replay: ReplayEvent,
  ) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Estadísticas operativas del outbox',
    description: 'Conteos por estado: Pending/Processing/Published/Failed/DeadLetter.',
  })
  @ApiOkResponse({ type: OutboxStatsResponse })
  async getStats(): Promise<OutboxStatsResponse> {
    return unwrap(await this.stats.execute()) as OutboxStatsResponse;
  }

  @Get('events')
  @ApiOperation({ summary: 'Buscar eventos en el outbox con filtros' })
  @ApiOkResponse({ type: OutboxQueryResponse })
  async listEvents(@Query() q: QueryOutboxRequest): Promise<OutboxQueryResponse> {
    return unwrap(await this.query.execute(q)) as OutboxQueryResponse;
  }

  @Post('events/:eventId/replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay de un evento',
    description: 'Vuelve a poner el evento en Pending con retryCount=0. Se publicará en el siguiente ciclo.',
  })
  @ApiOkResponse({ type: OutboxEntryResponse })
  async replayEvent(@Param() params: EventIdParam) {
    return unwrap(await this.replay.execute({ eventId: params.eventId }));
  }

  @Get('dlq')
  @ApiOperation({ summary: 'Listar eventos en DeadLetter (excedieron maxRetries)' })
  @ApiOkResponse({ type: OutboxQueryResponse })
  async listDlq(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OutboxQueryResponse> {
    return unwrap(await this.dlq.execute({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    })) as OutboxQueryResponse;
  }

  @Post('dlq/:eventId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sacar un evento de DLQ y reintentarlo',
    description: 'Equivalente a replay pero semánticamente para eventos en DeadLetter.',
  })
  @ApiOkResponse({ type: OutboxEntryResponse })
  async retryDlq(@Param() params: EventIdParam) {
    return unwrap(await this.replay.execute({ eventId: params.eventId }));
  }
}

/**
 * Platform Read Models — consulta del read model agregado.
 *
 * El TenantSummary es una vista denormalizada actualizada por proyectores,
 * útil para dashboards: ver todos los tenants con sus métricas en una sola query.
 */
@ApiTags('Platform · Read Models')
@ApiBearerAuth()
@RequireRoles('Platform.Admin', 'Platform.Support', 'Platform.SRE')
@SkipAudit()
@Controller({ path: 'platform/read-models', version: '1' })
export class PlatformReadModelsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('tenant-summary')
  @ApiOperation({
    summary: 'Vista resumen de todos los tenants',
    description: 'Devuelve estado, plan y conteos de usuarios materializados por el TenantSummaryProjector.',
  })
  @ApiOkResponse({ type: [TenantSummaryResponse] })
  async tenantSummary(): Promise<TenantSummaryResponse[]> {
    const rows = await this.prisma.unsafeWithoutTenant(
      (tx) => tx.tenantSummary.findMany({ orderBy: { lastEventAt: 'desc' } }),
      'ReadModels — tenant summary',
    );
    return rows.map((r) => ({
      tenantId: r.tenantId,
      code: r.code,
      name: r.name,
      status: r.status,
      plan: r.plan,
      userCount: r.userCount,
      activeUserCount: r.activeUserCount,
      lastEventAt: r.lastEventAt.toISOString(),
      lastEventType: r.lastEventType,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
