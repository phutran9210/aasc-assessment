import type { CompiledMapping } from '../domain/mapping-compiler.js';
import type { MappingConfig } from '../schemas/mapping.schema.js';
import type { ScorePolicy } from '../types/rule.types.js';

export const DEFAULT_SCORE_POLICY: ScorePolicy = {
  weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
  interaction_window_days: 30,
  interaction_points: 5,
  interaction_cap: 4,
};

export const LINK_INTERVAL_MS = 5 * 60 * 1000;
export const LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Remote records are marked with the two standard CRM fields meant for external systems, so no
// custom field has to exist on the portal. `originatorId` names this integration and `originId`
// carries the marker of the local record.
export const REMOTE_ORIGINATOR = 'aasc-tiktok';
export function remoteMarkerFields(marker: string): { originatorId: string; originId: string } {
  return { originatorId: REMOTE_ORIGINATOR, originId: marker };
}
export const LEAD_SYNC_RECONCILIATION_DELAYS_MS = [5_000, 10_000, 15_000] as const;
// What the configuration API shows while no mapping has been stored; FALLBACK_MAPPING below is the
// same mapping in compiled form.
export const DEFAULT_MAPPING: MappingConfig = {
  entries: [
    { source: 'name', target: 'name', owner: 'integration', transforms: [] },
    { source: 'email', target: 'fm', subfield: 'EMAIL', owner: 'integration', transforms: [] },
    { source: 'phone', target: 'fm', subfield: 'PHONE', owner: 'integration', transforms: [] },
  ],
};
export const FALLBACK_MAPPING: CompiledMapping = {
  titleMaxLength: 180,
  entries: [
    { sourcePath: ['name'], target: 'name', subfield: null, transforms: [], owner: 'integration' },
    {
      sourcePath: ['email'],
      target: 'fm',
      subfield: 'EMAIL',
      transforms: [],
      owner: 'integration',
    },
    {
      sourcePath: ['phone'],
      target: 'fm',
      subfield: 'PHONE',
      transforms: [],
      owner: 'integration',
    },
    { sourcePath: ['city'], target: 'city', subfield: null, transforms: [], owner: 'integration' },
  ],
};

export const LEAD_SUCCESS_STAGE = 'CONVERTED';
export const DEAL_MARKER_PREFIX = 'aasc-tiktok/deal/';
export const CONVERSION_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;
export const ACTIVE_OPERATION_STATUSES = new Set(['pending', 'processing', 'retry_wait']);
export const TIMELINE_RETRY_DELAYS_MS = [5_000, 10_000, 15_000] as const;

export const DEAL_POLL_PAGE_SIZE = 50;
export const DEAL_POLL_OVERLAP_MS = 10 * 60 * 1000;
export const DEAL_POLL_INCREMENTAL_INTERVAL_MS = 5 * 60 * 1000;
export const DEAL_POLL_FULL_INTERVAL_MS = 24 * 60 * 60 * 1000;
