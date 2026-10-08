import { BitrixApiService } from '@modules/bitrix/index.js';
import { GoogleAuthProvider } from '@modules/google-sheets/index.js';

import { Injectable } from '@nestjs/common';

import { LEAD_SYNC_MESSAGES } from '../messages/index.js';

/** Answers "can a sync run at all?" without calling Google or Bitrix24. */
@Injectable()
export class LeadSyncReadiness {
  constructor(
    private readonly google: GoogleAuthProvider,
    private readonly bitrix: BitrixApiService,
  ) {}

  /** What is still missing, as a message for the admin; null when the integration is ready. */
  async missing(): Promise<string | null> {
    const google = this.google.missingConfig();
    if (google) return google;
    if (!(await this.bitrix.isConfigured())) return LEAD_SYNC_MESSAGES.ERROR.BITRIX_NOT_CONNECTED;
    return null;
  }
}
