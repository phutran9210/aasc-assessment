import type { EntityManager } from 'typeorm';

export const CONVERSION_FEEDBACK = Symbol('CONVERSION_FEEDBACK');

export type FeedbackMilestone = 'lead_qualified' | 'deal_created' | 'deal_won';

export type ConversionFeedbackScheduler = {
  schedule(leadId: string, milestone: FeedbackMilestone, tx: EntityManager): Promise<void>;
};
