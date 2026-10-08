import { LEAD_SYNC_MESSAGES } from '../messages/index.js';

/** The integration cannot run as configured; the message says what to fix. */
export class LeadSyncConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadSyncConfigError';
  }
}

/** `mapping.json` is wrong; `problems` names every offending column or field. */
export class LeadSyncMappingError extends LeadSyncConfigError {
  constructor(readonly problems: string[]) {
    super(LEAD_SYNC_MESSAGES.ERROR.MAPPING_INVALID(problems));
    this.name = 'LeadSyncMappingError';
  }
}

/** Another run holds the lock. */
export class LeadSyncBusyError extends Error {
  constructor(readonly runId: string | null) {
    super(LEAD_SYNC_MESSAGES.ERROR.BUSY(runId));
    this.name = 'LeadSyncBusyError';
  }
}
