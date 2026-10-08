export const TIKTOK_WEBHOOK_EVENTS = {
  leadGenerate: 'lead.generate',
  formComplete: 'form.complete',
  userInteraction: 'user.interaction',
} as const;

export const TIKTOK_DISPATCHED_EVENTS = new Set<string>(Object.values(TIKTOK_WEBHOOK_EVENTS));
