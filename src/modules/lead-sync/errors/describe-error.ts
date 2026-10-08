import { BitrixHttpError } from '@modules/bitrix/index.js';

import { BITRIX_CREDENTIAL_CODES, BITRIX_PLAN_BLOCKED_CODE } from '../constants/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';

/** Why a run stopped, as shown in the run log, the CLI and the admin page. */
export function describeError(error: unknown): string {
  if (error instanceof BitrixHttpError) {
    if (error.code === BITRIX_PLAN_BLOCKED_CODE) {
      return LEAD_SYNC_MESSAGES.ERROR.BITRIX_PLAN_BLOCKED(error.code);
    }
    if (error.code && BITRIX_CREDENTIAL_CODES.includes(error.code.toUpperCase())) {
      return LEAD_SYNC_MESSAGES.ERROR.BITRIX_CREDENTIALS(error.code);
    }
    return error.code ? `${error.message} (${error.code})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
