import type { ScoreInput, ScorePolicy, ScoreResult } from '../types/rule.types.js';

const DEFAULT_INTERACTION_ALLOWLIST = [
  'click',
  'submit',
  'view',
  'chat',
  'contact',
  'download',
  'share',
];

type ScoredSubmission = {
  eventId: string;
  occurredAt: Date;
  engagement: Record<string, unknown>;
};

/** Builds the score input of a lead from its stored submissions and interaction events. */
export function scoreInputFromSubmissions(
  lead: { email: string | null; phone: string | null },
  submissions: readonly ScoredSubmission[],
): ScoreInput {
  return {
    email: lead.email,
    phone_e164: lead.phone,
    form_complete: submissions.some((item) => item.engagement.event === 'form_complete'),
    interactions: submissions.flatMap((item) =>
      typeof item.engagement.event === 'string' && item.engagement.event !== 'form_complete'
        ? [
            {
              event_id: item.eventId,
              occurred_at: item.occurredAt.toISOString(),
              event: item.engagement.event,
            },
          ]
        : [],
    ),
    budget_match: false,
    timeline_match: false,
  };
}

export function scoreLead(input: ScoreInput, policy: ScorePolicy, now: string): ScoreResult {
  const evaluatedAt = new Date(now);
  if (Number.isNaN(evaluatedAt.getTime())) throw new RangeError('Invalid scoring timestamp');
  const windowStart = evaluatedAt.getTime() - policy.interaction_window_days * 24 * 60 * 60 * 1000;
  const allowlist = new Set(policy.interaction_allowlist ?? DEFAULT_INTERACTION_ALLOWLIST);
  const unique = new Set<string>();
  for (const interaction of input.interactions) {
    const occurredAt = new Date(interaction.occurred_at).getTime();
    if (
      !Number.isNaN(occurredAt) &&
      occurredAt >= windowStart &&
      occurredAt <= evaluatedAt.getTime() &&
      allowlist.has(interaction.event) &&
      interaction.event_id
    )
      unique.add(interaction.event_id);
  }
  const breakdown = {
    email:
      input.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
        ? policy.weights.email
        : 0,
    phone:
      input.phone_e164 && /^\+[1-9]\d{7,14}$/.test(input.phone_e164) ? policy.weights.phone : 0,
    form: input.form_complete ? policy.weights.form : 0,
    interaction: Math.min(unique.size, policy.interaction_cap) * policy.interaction_points,
    budget: input.budget_match ? policy.weights.budget : 0,
    timeline: input.timeline_match ? policy.weights.timeline : 0,
  };
  return {
    total: Math.min(
      100,
      Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    ),
    breakdown,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}
