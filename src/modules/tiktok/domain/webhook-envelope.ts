import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const customQuestionSchema = z.looseObject({
  question_id: z.string().max(255).optional(),
  question_text: z.string().max(2_000).optional(),
  answer: z.union([z.string().max(2_000), z.array(z.string().max(2_000)).max(100)]).optional(),
});

const leadDataSchema = z.looseObject({
  custom_questions: z.array(customQuestionSchema).max(100).optional(),
});

// The assignment nests the campaign and form IDs; the first samples of this app kept them flat.
const campaignSchema = z.looseObject({ campaign_id: z.string().max(255).optional() });
const formSchema = z.looseObject({ form_id: z.string().max(255).optional() });

const envelopeSchema = z.looseObject({
  event_id: z.string().trim().min(1).max(255),
  event: z.string().trim().min(1).max(100),
  advertiser_id: z.string().trim().min(1).max(255),
  timestamp: z.union([z.string().trim().min(1).max(64), z.number().positive()]),
  campaign_id: z.string().max(255).optional(),
  form_id: z.string().max(255).optional(),
  campaign: campaignSchema.optional(),
  form: formSchema.optional(),
  lead_data: leadDataSchema.optional(),
  custom_questions: z.array(customQuestionSchema).max(100).optional(),
});

export type VerifiedEvent = {
  eventId: string;
  eventType: string;
  advertiserId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export function parseWebhookEnvelope(value: unknown): VerifiedEvent {
  assertJsonDepth(value, 20);
  const result = envelopeSchema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid TikTok webhook envelope');
  const occurredAt = toDate(result.data.timestamp);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new BadRequestException('Invalid TikTok webhook timestamp');
  }
  if (result.data.event === 'lead.generate') {
    const campaignId = result.data.campaign_id ?? result.data.campaign?.campaign_id;
    const formId = result.data.form_id ?? result.data.form?.form_id;
    if (!campaignId || !formId || !result.data.lead_data) {
      throw new BadRequestException('Lead generation event is incomplete');
    }
  }
  return {
    eventId: result.data.event_id,
    eventType: result.data.event,
    advertiserId: result.data.advertiser_id,
    occurredAt,
    payload: value as Record<string, unknown>,
  };
}

/** An ISO string, or Unix time in seconds or milliseconds as the assignment sends it. */
function toDate(timestamp: string | number): Date {
  if (typeof timestamp === 'string') return new Date(timestamp);
  return new Date(timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp);
}

function assertJsonDepth(root: unknown, maxDepth: number): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 1 }];
  while (pending.length) {
    const item = pending.pop();
    if (!item) continue;
    if (item.depth > maxDepth)
      throw new BadRequestException('TikTok webhook JSON is too deeply nested');
    if (item.value && typeof item.value === 'object') {
      for (const [key, child] of Object.entries(item.value)) {
        if (key === 'custom_questions' && Array.isArray(child) && child.length > 100) {
          throw new BadRequestException('Too many TikTok custom questions');
        }
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
}
