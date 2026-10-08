/** Read and write access to spreadsheets shared with the account; no Drive-wide access. */
export const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Google allows 60 read and 60 write requests per minute per user; stay below that.
export const SHEETS_RATE_LIMIT = { PER_MINUTE: 50, WINDOW_MS: 60_000 } as const;

export const SHEETS_REQUEST_KINDS = ['read', 'write'] as const;
export type SheetsRequestKind = (typeof SHEETS_REQUEST_KINDS)[number];
