import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

import { COMMON_MESSAGES } from '../messages/index.js';

/**
 * Validates a `:id` route parameter. Rejecting malformed ids here returns a clear 400 instead of
 * running a query that can never match.
 *
 * @example `@Param('id', UuidParamPipe) id: string`
 */
export const UuidParamPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException(COMMON_MESSAGES.ERROR.INVALID_ID),
});
