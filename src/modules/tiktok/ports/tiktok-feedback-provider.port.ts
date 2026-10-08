export type FeedbackEvent = {
  eventId: string;
  advertiserId?: string;
  payload?: Record<string, unknown>;
};
export type EventResult = {
  eventId: string;
  status: 'accepted' | 'rejected';
  errorCode?: string;
};

export type TiktokFeedbackProvider = {
  sendEvents(events: FeedbackEvent[]): Promise<EventResult[]>;
};

export const TIKTOK_FEEDBACK_PROVIDER = Symbol('TIKTOK_FEEDBACK_PROVIDER');
