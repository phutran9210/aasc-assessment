import { scoreInputFromSubmissions, scoreLead } from '../domain/lead-score.js';
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

  describe('budget and timeline answers', () => {
    const configured: ScorePolicy = {
      ...policy,
      budget_values: ['5-10 triệu VND', 'Trên 10 triệu VND'],
      timeline_values: ['Trong 1 tháng'],
    };
    const lead = { email: null, phone: null };
    const submission = (occurredAt: string, customAnswers: Record<string, unknown>) => ({
      eventId: occurredAt,
      occurredAt: new Date(occurredAt),
      engagement: { event: 'form_complete' },
      customAnswers,
    });

    it('awards the points when the form answers are among the configured values', () => {
      const input = scoreInputFromSubmissions(
        lead,
        [
          submission('2026-10-08T10:00:00.000Z', {
            budget: ' 5-10 TRIỆU vnd ',
            timeline: 'Trong 1 tháng',
          }),
        ],
        configured,
      );

      expect(input).toMatchObject({ budget_match: true, timeline_match: true });
      expect(scoreLead(input, configured, now).breakdown).toMatchObject({
        budget: 15,
        timeline: 15,
      });
    });

    it('uses the newest submission that answered, ignoring later ones without an answer', () => {
      const input = scoreInputFromSubmissions(
        lead,
        [
          submission('2026-10-08T11:00:00.000Z', {}),
          submission('2026-10-08T10:00:00.000Z', { budget: 'Dưới 5 triệu VND' }),
          submission('2026-10-07T10:00:00.000Z', { budget: '5-10 triệu VND' }),
        ],
        configured,
      );

      expect(input.budget_match).toBe(false);
    });

    it('gives no points without an answer, a configured list, or a text answer', () => {
      const answered = [
        submission('2026-10-08T10:00:00.000Z', { budget: '5-10 triệu VND', timeline: ['x'] }),
      ];

      expect(scoreInputFromSubmissions(lead, answered, policy)).toMatchObject({
        budget_match: false,
        timeline_match: false,
      });
      expect(scoreInputFromSubmissions(lead, answered, configured).timeline_match).toBe(false);
      expect(scoreInputFromSubmissions(lead, [], configured)).toMatchObject({
        budget_match: false,
        timeline_match: false,
      });
    });
  });

  it('finds the budget and timeline answers under the question texts of the assignment', () => {
    const configured: ScorePolicy = {
      ...policy,
      budget_values: ['5-10 triệu VND'],
      timeline_values: ['Trong 1 tháng'],
    };
    const input = scoreInputFromSubmissions(
      { email: null, phone: null },
      [
        {
          eventId: 'evt_1234567890',
          occurredAt: new Date('2024-03-08T05:42:23.000Z'),
          engagement: { event: 'form_complete' },
          customAnswers: { 'Budget range': '5-10 triệu VND', Timeline: 'Trong 1 tháng' },
        },
      ],
      configured,
    );

    expect(input).toMatchObject({ budget_match: true, timeline_match: true });
  });
});
