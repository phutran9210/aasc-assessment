export type PollSummary = {
  mode: 'incremental' | 'full';
  scanned: number;
  queued: number;
  ignored: number;
  complete: boolean;
  skippedLocked: boolean;
  watermark: Date | null;
};
