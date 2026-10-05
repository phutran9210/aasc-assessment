import { Injectable, Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';

import type { Request, Response } from 'express';
import { tap } from 'rxjs';
import type { Observable } from 'rxjs';

import { elapsedMs, Temporal } from '../utils/index.js';

/**
 * Logs one line per successful HTTP request: `GET /contacts 200 +12ms`.
 * Only the path is logged: query strings can carry secrets (OAuth `code`, tokens, API keys).
 * Failed requests are logged by `HttpExceptionFilter`, so they are not repeated here.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const { method, path } = http.getRequest<Request>();
    const startedAt = Temporal.Now.instant();

    return next.handle().pipe(
      tap(() => {
        const { statusCode } = http.getResponse<Response>();
        this.logger.log(`${method} ${path} ${statusCode} +${elapsedMs(startedAt)}ms`);
      }),
    );
  }
}
