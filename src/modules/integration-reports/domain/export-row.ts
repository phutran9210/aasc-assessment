import { toMoneyString } from '@modules/integration-analytics/domain/money-metrics.js';

/** One exported lead. Identifiers and money are strings so no consumer rounds or reformats them. */
export type ExportRow = {
  localLeadId: string;
  remoteLeadId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string | null;
  formName: string | null;
  receivedAt: string;
  score: number;
  syncStatus: string;
  remoteDealId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  assignedTo: string | null;
  amount: string | null;
  currency: string | null;
  convertedAt: string | null;
};

export type ExportSourceRow = Omit<ExportRow, 'receivedAt' | 'convertedAt'> & {
  receivedAt: Date | string;
  convertedAt: Date | string | null;
};

export type ExportColumn = { key: keyof ExportRow; header: string; type: 'text' | 'number' };

/** Column order of every format. Raw payloads, consent evidence and tokens are never exported. */
export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'localLeadId', header: 'localLeadId', type: 'text' },
  { key: 'remoteLeadId', header: 'remoteLeadId', type: 'text' },
  { key: 'name', header: 'name', type: 'text' },
  { key: 'email', header: 'email', type: 'text' },
  { key: 'phone', header: 'phone', type: 'text' },
  { key: 'campaignId', header: 'campaignId', type: 'text' },
  { key: 'campaignName', header: 'campaignName', type: 'text' },
  { key: 'adId', header: 'adId', type: 'text' },
  { key: 'adName', header: 'adName', type: 'text' },
  { key: 'formId', header: 'formId', type: 'text' },
  { key: 'formName', header: 'formName', type: 'text' },
  { key: 'receivedAt', header: 'receivedAt', type: 'text' },
  { key: 'score', header: 'score', type: 'number' },
  { key: 'syncStatus', header: 'syncStatus', type: 'text' },
  { key: 'remoteDealId', header: 'remoteDealId', type: 'text' },
  { key: 'pipelineId', header: 'pipelineId', type: 'text' },
  { key: 'stageId', header: 'stageId', type: 'text' },
  { key: 'assignedTo', header: 'assignedTo', type: 'text' },
  { key: 'amount', header: 'amount', type: 'text' },
  { key: 'currency', header: 'currency', type: 'text' },
  { key: 'convertedAt', header: 'convertedAt', type: 'text' },
] as const;

export function toExportRow(source: ExportSourceRow): ExportRow {
  return {
    localLeadId: source.localLeadId,
    remoteLeadId: source.remoteLeadId,
    name: source.name,
    email: source.email,
    phone: source.phone,
    campaignId: source.campaignId,
    campaignName: source.campaignName,
    adId: source.adId,
    adName: source.adName,
    formId: source.formId,
    formName: source.formName,
    receivedAt: new Date(source.receivedAt).toISOString(),
    score: Number(source.score),
    syncStatus: source.syncStatus,
    remoteDealId: source.remoteDealId,
    pipelineId: source.pipelineId,
    stageId: source.stageId,
    assignedTo: source.assignedTo,
    amount: source.amount === null ? null : toMoneyString(source.amount),
    currency: source.currency,
    convertedAt: source.convertedAt === null ? null : new Date(source.convertedAt).toISOString(),
  };
}
