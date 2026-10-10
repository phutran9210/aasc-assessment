import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type {
  CrmGateway,
  RemoteDeal,
  RemoteLead,
  TimelineEntry,
  TimelineQuery,
} from '../ports/crm-gateway.port.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';
import type { ReconcileResult } from '../types/reconcile-result.type.js';

@Injectable()
export class RemoteReconciliationService {
  constructor(@Inject(CRM_GATEWAY) private readonly gateway: CrmGateway) {}

  async find(
    kind: 'lead' | 'deal' | 'timeline',
    marker: string,
    // A timeline comment can only be looked up on the record it was written to.
    entity?: Pick<TimelineQuery, 'entityType' | 'entityId'>,
  ): Promise<ReconcileResult<RemoteLead | RemoteDeal | TimelineEntry>> {
    if (kind === 'timeline') {
      if (!entity) throw new TypeError('A timeline lookup needs its CRM record');
      const entries = await this.gateway.findTimeline({ ...entity, marker });
      return classify(entries);
    }
    if (kind === 'deal') {
      const candidates = await this.gateway.findDeals({ marker, limit: 2 });
      return classify(candidates);
    }
    const candidates = await this.gateway.findLeadCandidates({ marker, limit: 2 });
    if (candidates.length > 1) return { status: 'ambiguous', candidates };
    const candidate = candidates[0];
    if (!candidate) return { status: 'not_found' };
    try {
      const lead = await this.gateway.getLead(candidate.id);
      return { status: 'found', value: lead };
    } catch (error) {
      if (error instanceof NotFoundException) return { status: 'not_found' };
      throw error;
    }
  }
}

function classify<T>(values: T[]): ReconcileResult<T> {
  if (values.length > 1) return { status: 'ambiguous', candidates: values };
  const value = values[0];
  return value ? { status: 'found', value } : { status: 'not_found' };
}
