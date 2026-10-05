/** One answered question of a Jotform submission, as returned by the Jotform API. */
export type JotformAnswer = {
  name?: string;
  order?: string;
  text?: string;
  type?: string;
  answer?: unknown;
  prettyFormat?: string;
};

/** `content` of `GET /submission/{id}` and each item of `GET /form/{id}/submissions`. */
export type JotformSubmissionContent = {
  id: string;
  form_id: string;
  created_at?: string;
  status?: string;
  answers?: Record<string, JotformAnswer>;
};

/** The three form fields, ready for Bitrix24: NAME, PHONE and EMAIL of a Contact. */
export type JotformContactFields = { name: string; phone: string; email: string };

export type JotformSyncStatus = 'synced' | 'duplicate' | 'processing';

export type JotformSyncOutcome = {
  status: JotformSyncStatus;
  submissionId: string;
  contactId: string | null;
};

export type JotformSyncSummary = {
  total: number;
  synced: number;
  duplicate: number;
  processing: number;
  failed: number;
};
