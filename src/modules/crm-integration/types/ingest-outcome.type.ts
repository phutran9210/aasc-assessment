export type IngestOutcome =
  | { outcome: 'succeeded'; leadId: string; version: number }
  | { outcome: 'quarantined'; errorCode: string }
  | { outcome: 'awaiting_link'; submissionId: string; nextAttemptAt: Date | null }
  | { outcome: 'unmatched'; submissionId: string };
