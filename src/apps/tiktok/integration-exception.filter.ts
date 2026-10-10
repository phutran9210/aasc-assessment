import { STATUS_CODES } from 'node:http';

import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';

import { HttpExceptionFilter } from '@common/filters/index.js';

/**
 * The shared error shape, with two cases this application needs kept as they are:
 * - an exception that carries a report instead of a message (the readiness report behind a 503)
 *   is answered with that report;
 * - a failure raised by the body parser before any controller runs (413 for an oversized webhook)
 *   keeps its client status instead of becoming a 500.
 */
@Catch()
export class IntegrationExceptionFilter extends HttpExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http' && exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && !('message' in payload)) {
        host.switchToHttp().getResponse<Response>().status(exception.getStatus()).json(payload);
        return;
      }
    }
    super.catch(clientError(exception) ?? exception, host);
  }
}

function clientError(exception: unknown): HttpException | null {
  if (exception instanceof HttpException || typeof exception !== 'object' || exception === null) {
    return null;
  }
  const { status } = exception as { status?: unknown };
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499) {
    return null;
  }
  return new HttpException(STATUS_CODES[status] ?? 'Bad Request', status);
}
