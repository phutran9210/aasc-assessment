import { scoreLead } from '../domain/lead-score.js';
import type { ScorePolicy } from '../types/rule.types.js';

const policy: ScorePolicy = {
  weights: { email: 15, phone: 15, form: 20, interaction: 20, budget: 15, timeline: 15 },
  interaction_window_days: 30,
  interaction_points: 5,
  interaction_cap: 4,
};
const now = '2026-10-08T12:00:00.000Z';

describe('lead score', () => {
  it('scores a complete lead to 100 with an explainable breakdown', () => {
    const result = scoreLead(
      {
        email: 'person@example.test',
        phone_e164: '+84901234567',
        form_complete: true,
        interactions: [
          { event_id: 'a', occurred_at: '2026-10-08T11:00:00.000Z', event: 'click' },
          { event_id: 'b', occurred_at: '2026-10-07T11:00:00.000Z', event: 'submit' },
          { event_id: 'c', occurred_at: '2026-10-06T11:00:00.000Z', event: 'view' },
          { event_id: 'd', occurred_at: '2026-10-05T11:00:00.000Z', event: 'chat' },
        ],
        budget_match: true,
        timeline_match: true,
      },
      policy,
      now,
    );
    expect(result.total).toBe(100);
  });

  it('counts each interaction event once and excludes events older than 30 days', () => {
    const result = scoreLead(
      {
        email: null,
        phone_e164: null,
        form_complete: false,
        interactions: [
          { event_id: 'same', occurred_at: '2026-10-08T11:00:00.000Z', event: 'click' },
          { event_id: 'same', occurred_at: '2026-10-08T10:00:00.000Z', event: 'click' },
          { event_id: 'old', occurred_at: '2026-09-07T12:00:00.000Z', event: 'click' },
        ],
        budget_match: false,
        timeline_match: false,
      },
      policy,
      now,
    );
    expect(result.breakdown.interaction).toBe(5);
    expect(result.total).toBe(5);
  });
});
