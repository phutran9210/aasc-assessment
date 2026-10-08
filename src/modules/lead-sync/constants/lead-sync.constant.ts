import type { LeadSyncCountry } from '@config/index.js';

/** Header texts of the columns the app owns. Columns are always found by header, never by letter. */
export const SHEET_COLUMNS = {
  STATUS: 'Trạng thái đồng bộ',
  LEAD_ID: 'Lead ID Bitrix24',
  SYNCED_AT: 'Thời gian đồng bộ cuối',
  ERROR: 'Thông báo lỗi',
  HASH: 'Sync Hash',
} as const;

export type TechnicalColumn = (typeof SHEET_COLUMNS)[keyof typeof SHEET_COLUMNS];

/** Order in which missing technical columns are appended to the header row. */
export const TECHNICAL_COLUMNS: readonly TechnicalColumn[] = [
  SHEET_COLUMNS.STATUS,
  SHEET_COLUMNS.LEAD_ID,
  SHEET_COLUMNS.SYNCED_AT,
  SHEET_COLUMNS.ERROR,
  SHEET_COLUMNS.HASH,
];

export const HIDDEN_COLUMNS: readonly TechnicalColumn[] = [
  SHEET_COLUMNS.LEAD_ID,
  SHEET_COLUMNS.HASH,
];

/** Values of the `Trạng thái đồng bộ` column. A blank cell means PENDING. */
export const SYNC_STATUS = {
  PENDING: 'Chờ xử lý',
  SYNCED: 'Đã đồng bộ',
  ERROR: 'Lỗi',
} as const;

export const FIELD_TYPES = ['string', 'email', 'phone', 'number', 'date', 'enum', 'user'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const DEDUPE_KEYS = ['email', 'phone'] as const;
export type DedupeKey = (typeof DEDUPE_KEYS)[number];

/** Mapping targets that are not lead fields: they become entries of the `fm` multifield. */
export const SPECIAL_FIELDS: readonly string[] = DEDUPE_KEYS;

/** What a cell shows when its formula failed. */
export const SHEET_ERROR_VALUES: readonly string[] = [
  '#N/A',
  '#REF!',
  '#VALUE!',
  '#DIV/0!',
  '#NAME?',
  '#NUM!',
  '#NULL!',
  '#ERROR!',
];

/** Calling code and length of the national number (without the leading 0) per country. */
export const COUNTRY_PHONE_RULES: Record<
  LeadSyncCountry,
  { code: string; nationalLength: number }
> = {
  VN: { code: '84', nationalLength: 9 },
  US: { code: '1', nationalLength: 10 },
  SG: { code: '65', nationalLength: 8 },
};

/** `v1:<hash>` = synced with this content; `invalid:<hash>` = rejected with this content. */
export const HASH_KIND = { SYNCED: 'v1', INVALID: 'invalid' } as const;
export type HashKind = (typeof HASH_KIND)[keyof typeof HASH_KIND];

export const LEAD_SYNC_RUN_STATUS = {
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  PARTIAL: 'partial',
  FAILED: 'failed',
  ABORTED: 'aborted',
} as const;
export type LeadSyncRunStatus = (typeof LEAD_SYNC_RUN_STATUS)[keyof typeof LEAD_SYNC_RUN_STATUS];

/** `webhook` and `pull` are Bitrix24 → Sheet runs: after a Bitrix24 event, or asked for by hand. */
export const LEAD_SYNC_TRIGGERS = ['schedule', 'http', 'cli', 'webhook', 'pull'] as const;
export type LeadSyncTrigger = (typeof LEAD_SYNC_TRIGGERS)[number];

export const RUN_ITEM_ACTIONS = ['create', 'update', 'fail'] as const;
export type RunItemAction = (typeof RUN_ITEM_ACTIONS)[number];

/** Lead in the universal `crm.item.*` API. */
export const LEAD_ENTITY_TYPE_ID = 1;

/** Marks leads created by this integration, to tell them from manually entered ones. */
export const LEAD_ORIGINATOR_FIELD = 'originatorId';
export const LEAD_ORIGINATOR_ID = 'google-sheets';

/** Longest error text written to the Sheet and to the run log. */
export const ERROR_MESSAGE_MAX_LENGTH = 500;

/** How often a running sync refreshes its lock; must stay well below `lockStaleMs`. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Error codes of one batch command that are worth retrying on the next run. */
export const BITRIX_TRANSIENT_CODES: readonly string[] = [
  'QUERY_LIMIT_EXCEEDED',
  'OVERLOAD_LIMIT',
  'INTERNAL_SERVER_ERROR',
  'ERROR_UNEXPECTED_ANSWER',
  'NO_RESULT',
];

/** Bitrix24 blocks a method for a while after it used too much execution time: stop the run. */
export const BITRIX_TIME_LIMIT_CODE = 'OPERATION_TIME_LIMIT';
/** Bitrix24 answers this to every REST call when the portal's plan does not include the REST API. */
export const BITRIX_PLAN_BLOCKED_CODE = 'FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN';
