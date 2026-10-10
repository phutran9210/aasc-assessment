import { STATUS_CODES } from 'node:http';

import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

import type { Request, Response } from 'express';

import { COMMON_MESSAGES } from '../messages/index.js';
import type { ErrorResponse } from '../types/index.js';
import { nowIso } from '../utils/index.js';

/**
 * Global filter: turns every thrown error into one `ErrorResponse` shape and logs it.
 * Unknown (non-HTTP) errors are reported as 500 without leaking internal details.
 * `path` never includes the query string, which can carry secrets (OAuth `code`, tokens).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.catchNonHttp(exception, host);
      return;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const statusCode = this.resolveStatus(exception);
    const body: ErrorResponse = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message: this.resolveMessage(exception, request),
      ...this.resolveCode(exception),
      path: request.path,
      timestamp: nowIso(),
    };

    this.log(exception, request.method, body);
    response.status(statusCode).json(body);
  }

  /**
   * WebSocket handlers answer through acknowledgements (`toAck`), so reaching this point means
   * something escaped them. There is no HTTP response to write: log it and tell the socket.
   */
  private catchNonHttp(exception: unknown, host: ArgumentsHost): void {
    this.logger.error(
      `Unhandled ${host.getType()} exception: ${exception instanceof Error ? exception.message : String(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    const client = host.switchToWs().getClient<{ emit?: (event: string, body: unknown) => void }>();
    client.emit?.('exception', { message: COMMON_MESSAGES.ERROR.INTERNAL });
  }

  private resolveStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * Keeps validation errors as an array, everything else as a single string.
   * NestJS echoes the full URL in its "Cannot GET ..." message, so the URL is reduced to the path.
   */
  private resolveMessage(exception: unknown, request: Request): string | string[] {
    if (!(exception instanceof HttpException)) return COMMON_MESSAGES.ERROR.INTERNAL;

    const withoutQuery = (text: string): string => text.replaceAll(request.url, request.path);
    const payload = exception.getResponse();
    if (typeof payload === 'string') return withoutQuery(payload);

    const { message } = payload as { message?: unknown };
    if (typeof message === 'string') return withoutQuery(message);
    if (Array.isArray(message)) return message.map((item) => withoutQuery(String(item)));
    return withoutQuery(exception.message);
  }

  private resolveCode(exception: unknown): { code?: string } {
    if (!(exception instanceof HttpException)) return {};
    const payload = exception.getResponse();
    if (typeof payload !== 'object' || payload === null) return {};
    const { code } = payload as { code?: unknown };
    return typeof code === 'string' ? { code } : {};
  }

  /** 5xx are server faults (error + stack trace); 4xx are client faults (warn). */
  private log(exception: unknown, method: string, body: ErrorResponse): void {
    const summary = `${method} ${body.path} ${body.statusCode} - ${JSON.stringify(body.message)}`;

    if (body.statusCode >= 500) {
      this.logger.error(summary, exception instanceof Error ? exception.stack : String(exception));
      return;
    }
    this.logger.warn(summary);
  }
}
