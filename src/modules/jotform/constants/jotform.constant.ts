/** Jotform question types the mapper reads. */
export const JOTFORM_QUESTION_TYPES = {
  FULL_NAME: 'control_fullname',
  TEXT: 'control_textbox',
  PHONE: 'control_phone',
  EMAIL: 'control_email',
} as const;

/**
 * PROCESSING: a request is creating the contact right now.
 * SYNCED: the contact exists in Bitrix24.
 * FAILED: Jotform or Bitrix24 was unreachable; safe to retry.
 * INVALID: the submitted data cannot become a contact; retried in case it was edited.
 */
export const JOTFORM_SUBMISSION_STATUS = {
  PROCESSING: 'PROCESSING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
  INVALID: 'INVALID',
} as const;

export type JotformSubmissionStatus =
  (typeof JOTFORM_SUBMISSION_STATUS)[keyof typeof JOTFORM_SUBMISSION_STATUS];

// A PROCESSING row older than this belongs to a request that died; another one may take over.
export const JOTFORM_CLAIM_STALE_MS = 120_000;

// Submissions read per `POST /jotform/sync` run.
export const JOTFORM_SYNC_PAGE_SIZE = 100;

export const JOTFORM_ERROR_MAX_LENGTH = 500;
