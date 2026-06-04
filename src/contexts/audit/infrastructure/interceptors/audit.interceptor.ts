import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

import {
  CLOCK_PORT,
  ClockPort,
  TENANT_CONTEXT_PORT,
  TenantContextPort,
} from '@eliza/shared-kernel/application/ports';
import { ClsService } from 'nestjs-cls';
import {
  CLS_REQUEST_IP,
  CLS_USER_AGENT,
} from '@eliza/shared-kernel/infrastructure/tenant-context/tenant-context.service';

import {
  AUDIT_LOG_REPOSITORY,
  AuditAction,
  AuditLogRepository,
} from '../../domain';

/**
 * Metadata para marcar un endpoint con clasificación de auditoría.
 *
 * Uso:
 *   @Audit({ action: 'Create', entityType: 'Tenant', extractEntityId: (req, res) => res.id })
 *   @Post()
 *   async createTenant() { ... }
 *
 * Si NO se decora, el interceptor aplica heurística por defecto:
 *   - HTTP method → action verb (POST=Create, PATCH=Update, DELETE=Delete)
 *   - Controller name → entityType
 *   - URL path tail → entityId (si parece UUID)
 *
 * Decorar @SkipAudit() salta auditoría para endpoints como health, docs.
 */
export const AUDIT_META_KEY = 'audit:metadata';
export const SKIP_AUDIT_KEY = 'audit:skip';

export interface AuditMetadata {
  action: string;
  entityType: string;
  extractEntityId?: (req: Request, response: unknown) => string | null;
  /** Captura el body como newValues. Default true. */
  captureBody?: boolean;
}

export function Audit(meta: AuditMetadata) {
  return applyDecorators(SetMetadata(AUDIT_META_KEY, meta));
}

export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

/**
 * AuditInterceptor — engancha en el ciclo response de Nest y registra
 * automáticamente cada operación de mutación.
 *
 * Comportamiento:
 *   - GET, HEAD, OPTIONS → no auditados (son lecturas)
 *   - POST/PATCH/PUT/DELETE → auditados
 *   - @SkipAudit() → siempre saltado
 *   - Error en el handler → audita como SecurityViolation si fue 403/401
 *
 * El recorder se llama DESPUÉS del response — no en el path crítico.
 * Si falla (e.g. BD audit caída), loggea pero NO falla el request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  private static readonly MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditRepo: AuditLogRepository,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly ctx: TenantContextPort,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    if (!AuditInterceptor.MUTATION_METHODS.has(req.method)) {
      return next.handle();
    }

    const meta = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_META_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const action = meta?.action ?? this.inferAction(req.method);
    const entityType = meta?.entityType ?? this.inferEntityType(context);
    const captureBody = meta?.captureBody ?? true;

    return next.handle().pipe(
      tap((response: unknown) => {
        this.recordSuccess(req, action, entityType, captureBody, meta, response);
      }),
      catchError((error: unknown) => {
        this.recordFailure(req, action, entityType, error);
        return throwError(() => error);
      }),
    );
  }

  // -------- Recording (fire-and-forget) --------
  private recordSuccess(
    req: Request,
    action: string,
    entityType: string,
    captureBody: boolean,
    meta: AuditMetadata | undefined,
    response: unknown,
  ): void {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) return; // sin tenant no podemos auditar

    void this.auditRepo.append({
      tenantId,
      occurredAt: this.clock.now(),
      userId: this.ctx.tryGetUserId(),
      ipAddress: this.cls.get<string>(CLS_REQUEST_IP) ?? null,
      userAgent: this.cls.get<string>(CLS_USER_AGENT) ?? null,
      action,
      entityType,
      entityId: this.extractEntityId(req, meta, response),
      oldValues: null,
      newValues: captureBody ? this.sanitizeBody(req.body) : null,
      correlationId: this.ctx.getCorrelationId(),
      causationId: null,
    }).catch((e) => {
      // CRÍTICO: nunca propagamos errores de auditoría al request original.
      // Pero sí los logueamos con severidad ERROR para monitoring/alertas.
      this.logger.error(
        `Failed to record audit ${action}/${entityType}: ${(e as Error).message}`,
        (e as Error).stack,
      );
    });
  }

  private recordFailure(
    req: Request,
    action: string,
    entityType: string,
    error: unknown,
  ): void {
    const tenantId = this.ctx.tryGetTenantId();
    if (!tenantId) return;

    const errorObj = error as { status?: number; code?: string; message?: string };
    const isSecurityRelated = errorObj.status === 401 || errorObj.status === 403;

    void this.auditRepo.append({
      tenantId,
      occurredAt: this.clock.now(),
      userId: this.ctx.tryGetUserId(),
      ipAddress: this.cls.get<string>(CLS_REQUEST_IP) ?? null,
      userAgent: this.cls.get<string>(CLS_USER_AGENT) ?? null,
      action: isSecurityRelated ? AuditAction.create('AccessDenied').isOk ? 'AccessDenied' : action : `${action}Failed`,
      entityType,
      entityId: null,
      oldValues: null,
      newValues: {
        error: {
          status: errorObj.status,
          code: errorObj.code,
          message: errorObj.message,
        },
        path: req.path,
        method: req.method,
      },
      correlationId: this.ctx.getCorrelationId(),
      causationId: null,
    }).catch((e) => {
      this.logger.error(`Failed to record failure audit: ${(e as Error).message}`);
    });
  }

  // -------- Inference helpers --------
  private inferAction(method: string): string {
    switch (method) {
      case 'POST': return 'Create';
      case 'PATCH':
      case 'PUT': return 'Update';
      case 'DELETE': return 'Delete';
      default: return method;
    }
  }

  private inferEntityType(context: ExecutionContext): string {
    return context.getClass().name.replace(/Controller$/, '');
  }

  private extractEntityId(
    req: Request,
    meta: AuditMetadata | undefined,
    response: unknown,
  ): string | null {
    if (meta?.extractEntityId) {
      try {
        return meta.extractEntityId(req, response);
      } catch {
        return null;
      }
    }
    // Heurística: si la URL termina en algo que parece UUID, ese es el id
    const segments = req.path.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last)) {
      return last;
    }
    // O si el response trae un id en raíz
    if (response && typeof response === 'object' && 'id' in response) {
      const id = (response as { id: unknown }).id;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  private sanitizeBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    const SENSITIVE = ['password', 'temporaryPassword', 'token', 'clientSecret', 'secret'];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      out[k] = SENSITIVE.includes(k) ? '[REDACTED]' : v;
    }
    return out;
  }
}
