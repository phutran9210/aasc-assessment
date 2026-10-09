import type { Readable } from 'node:stream';

export const EXPORT_FORMATS = ['csv', 'json', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportQuery = {
  format: ExportFormat;
  from?: string;
  to?: string;
  timezone?: string;
  dateRange?: string;
  campaignId?: string;
};

export type ExportScope = {
  advertiserId: string;
  tiktokMode: 'mock' | 'business-api';
  bitrixMode: 'mock' | 'real';
  reportTimezone?: string;
};

export type ExportMetadata = {
  scope: 'leads';
  from: string;
  to: string;
  timezone: string;
  /** Leads are filtered by their local creation time, not by first touch. */
  timeBasis: 'createdAt';
  providerMode: { tiktok: ExportScope['tiktokMode']; bitrix: ExportScope['bitrixMode'] };
  campaignId: string | null;
  snapshotAt: string;
};

export type ExportArtifact = {
  stream: Readable;
  size: number;
  contentType: string;
  filename: string;
  rowCount: number;
  metadata: ExportMetadata;
};

export type ArtifactRef = { path: string; hash: string; size: number };

export type AuthorizedArtifact = {
  stream: Readable;
  size: number;
  contentType: string;
  filename: string;
};

export type ReportJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type ReportJobDto = {
  id: string;
  kind: 'export' | 'import' | 'scheduled';
  status: string;
  format: string | null;
  filters: Record<string, unknown>;
  snapshotAt: string | null;
  totalRows: number;
  successRows: number;
  failedRows: number;
  expiresAt: string | null;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
