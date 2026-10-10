import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * True when the remote system answered and refused the request, so nothing was written there. A
 * timeout, a dropped connection or a 5xx answer says nothing about the write and is not a refusal.
 */
export function isRemoteRejection(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const status = error.getStatus();
  return status >= 400 && status < 500 && status !== Number(HttpStatus.REQUEST_TIMEOUT);
}

export function isRateLimited(error: unknown): boolean {
  return (
    error instanceof HttpException && error.getStatus() === Number(HttpStatus.TOO_MANY_REQUESTS)
  );
}
