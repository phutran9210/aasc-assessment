import { createHash } from 'node:crypto';

import {
  normalizeEmail,
  normalizePhone,
} from '@modules/crm-integration/domain/normalize-contact.js';
import type { FeedbackPolicy } from '@modules/crm-integration/index.js';
import type { FeedbackEvent } from '../ports/tiktok-feedback-provider.port.js';

export type FeedbackMilestone = 'lead_qualified' | 'deal_created' | 'deal_won';

export type FeedbackInput = {
  advertiserId: string;
  leadId: string;
  milestone: FeedbackMilestone;
  occurredAt: Date;
  consented: boolean;
  providerMode: 'mock' | 'business-api';
  email?: string | null;
  phone?: string | null;
  ttclid?: string | null;
};

export type FeedbackBuildResult =
  | { status: 'ready'; event: FeedbackEvent }
  | { status: 'skipped_no_consent'; reason: 'consent_missing' }
  | {
      status: 'disabled';
      reason: 'feedback_disabled' | 'event_mapping_missing' | 'provider_mode_unsupported';
    };

export function buildFeedback(input: FeedbackInput, policy: FeedbackPolicy): FeedbackBuildResult {
  if (!input.consented) return { status: 'skipped_no_consent', reason: 'consent_missing' };
  if (!policy.enabled) return { status: 'disabled', reason: 'feedback_disabled' };
  if (input.providerMode !== 'mock') {
    return { status: 'disabled', reason: 'provider_mode_unsupported' };
  }
  const eventName = policy.event_mapping?.[input.milestone];
  if (!eventName) return { status: 'disabled', reason: 'event_mapping_missing' };

  const user: Record<string, string> = {};
  const allowed = new Set(policy.matching_keys ?? []);
  if (allowed.has('email')) {
    const email = normalizeEmail(input.email);
    if (email) user.email = policy.hash_email ? sha256(email) : email;
  }
  if (allowed.has('phone')) {
    const phone = normalizePhone(input.phone, 'VN');
    if (phone) user.phone = policy.hash_phone ? sha256(phone) : phone;
  }
  if (allowed.has('ttclid') && input.ttclid) user.ttclid = input.ttclid;

  const eventId = createHash('sha256')
    .update(`${input.advertiserId}\0${input.leadId}\0${input.milestone}`)
    .digest('hex');
  return {
    status: 'ready',
    event: {
      eventId,
      advertiserId: input.advertiserId,
      payload: {
        event: eventName,
        eventSource: 'crm',
        eventSourceId: input.advertiserId,
        eventTime: input.occurredAt.toISOString(),
        context: { user },
      },
    },
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
