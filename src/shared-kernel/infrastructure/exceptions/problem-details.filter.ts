import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';

import { ApplicationError, ApplicationErrorCategory } from '../../application/use-case';
import { CLS_CORRELATION_ID } from '../tenant-context/tenant-context.service';

/**
 * Filtro global de excepciones — devuelve respuestas en formato
 * Problem Details (RFC 7807).
 *
 * Estructura de la respuesta:
 *   {
 *     "type":   "https://docs.eliza.app/errors/<code>",
 *     "title":  "Human-readable summary",
 *     "status": <http-status>,
 *     "detail": "What went wrong, specifically",
 *     "instance": "/api/v1/tenants/abc-123",
 *     "code":   "tenant.code_already_exists",
 *     "correlationId": "01H...",
 *     "errors": [...]      // solo para validation errors
 *   }
 *
 * Nunca filtra detalles internos: stack traces, queries SQL, secrets.
 * Los logs (Pino) sí los conservan internamente para debugging.
 */
@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  private static readonly DOCS_BASE = 'https://docs.eliza.app/errors';
  private readonly logger = new Logger(ProblemDetailsExceptionFilter.name);

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ url: string; method: string }>();
    const correlationId = this.cls.get<string>(CLS_CORRELATION_ID) ?? 'unknown';

    const problem = this.toProblem(exception, req.url, correlationId);

    // Log estructurado: errores 5xx con stack, 4xx solo metadata.
    if (problem.status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${problem.status} ${problem.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(
        `${req.method} ${req.url} → ${problem.status} ${problem.code}`,
      );
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(
    exception: unknown,
    instance: string,
    correlationId: string,
  ): ProblemDetails {
    // 1. ApplicationError (devuelto por UseCases vía Result.err)
    if (this.isApplicationError(exception)) {
      return this.buildFromAppError(exception, instance, correlationId);
    }

    // 2. NestJS HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (response as { message?: string | string[] })?.message;

      return {
        type: `${ProblemDetailsExceptionFilter.DOCS_BASE}/http-${status}`,
        title: this.titleFor(status),
        status,
        detail: Array.isArray(message) ? message.join('; ') : message ?? exception.message,
        instance,
        code: `http.${status}`,
        correlationId,
      };
    }

    // 3. Cualquier otra cosa = 500 Internal Server Error
    return {
      type: `${ProblemDetailsExceptionFilter.DOCS_BASE}/internal-server-error`,
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred. The incident has been logged.',
      instance,
      code: 'internal.unhandled_exception',
      correlationId,
    };
  }

  private buildFromAppError(
    error: ApplicationError,
    instance: string,
    correlationId: string,
  ): ProblemDetails {
    const status = this.statusFromCategory(error.category);
    return {
      type: `${ProblemDetailsExceptionFilter.DOCS_BASE}/${error.code}`,
      title: this.titleFor(status),
      status,
      detail: error.message,
      instance,
      code: error.code,
      correlationId,
      ...(error.details ? { errors: error.details } : {}),
    };
  }

  private statusFromCategory(c: ApplicationErrorCategory): number {
    switch (c) {
      case 'validation':
        return HttpStatus.BAD_REQUEST;
      case 'not_found':
        return HttpStatus.NOT_FOUND;
      case 'conflict':
        return HttpStatus.CONFLICT;
      case 'unauthorized':
        return HttpStatus.UNAUTHORIZED;
      case 'forbidden':
      case 'tenant_inactive':
        return HttpStatus.FORBIDDEN;
      case 'concurrency':
        return HttpStatus.PRECONDITION_FAILED;
      case 'infrastructure':
        return HttpStatus.SERVICE_UNAVAILABLE;
      case 'domain':
      default:
        return HttpStatus.UNPROCESSABLE_ENTITY;
    }
  }

  private titleFor(status: number): string {
    switch (status) {
      case 400: return 'Bad Request';
      case 401: return 'Unauthorized';
      case 403: return 'Forbidden';
      case 404: return 'Not Found';
      case 409: return 'Conflict';
      case 412: return 'Precondition Failed';
      case 422: return 'Unprocessable Entity';
      case 503: return 'Service Unavailable';
      default:  return status >= 500 ? 'Internal Server Error' : 'Error';
    }
  }

  private isApplicationError(value: unknown): value is ApplicationError {
    return (
      typeof value === 'object' &&
      value !== null &&
      'code' in value &&
      'category' in value &&
      'message' in value
    );
  }
}

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  correlationId: string;
  errors?: unknown;
}
