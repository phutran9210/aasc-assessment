import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type {
  CrmGateway,
  RemoteDeal,
  RemoteLead,
  TimelineEntry,
} from '../ports/crm-gateway.port.js';
import { CRM_GATEWAY } from '../ports/crm-gateway.port.js';

export type ReconcileResult<T> =
  | { status: 'found'; value: T }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: T[] };

@Injectable()
export class RemoteReconciliationService {
  constructor(@Inject(CRM_GATEWAY) private readonly gateway: CrmGateway) {}

  async find(
    kind: 'lead' | 'deal' | 'timeline',
    marker: string,
  ): Promise<ReconcileResult<RemoteLead | RemoteDeal | TimelineEntry>> {
    if (kind === 'timeline') {
      const entries = await this.gateway.findTimeline(marker);
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
