import type { NormalizedLeadInput } from '../types/normalized-lead.type.js';

export type LeadSnapshot = {
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  interests?: string[];
  fieldProvenance: Record<string, unknown>;
};

export type MergeResult = {
  lead: LeadSnapshot;
  changedFields: string[];
};

type FieldProvenance = { occurredAt: string; eventKey: string };
const SCALAR_FIELDS = ['name', 'email', 'phone', 'city'] as const;

export function mergeLead(current: LeadSnapshot, incoming: NormalizedLeadInput): MergeResult {
  const lead: LeadSnapshot = {
    ...current,
    interests: [...(current.interests ?? [])],
    fieldProvenance: { ...current.fieldProvenance },
  };
  const changedFields: string[] = [];
  const incomingTime = incoming.occurredAt ?? new Date(0).toISOString();

  for (const field of SCALAR_FIELDS) {
    const value = incoming[field];
    if (typeof value !== 'string' || value.trim() === '') continue;
    const prior = asProvenance(lead.fieldProvenance[field]);
    if (prior && !incomingWins(incomingTime, incoming.eventKey, prior)) continue;
    if (lead[field] !== value) {
      lead[field] = value;
      changedFields.push(field);
    }
    lead.fieldProvenance[field] = { occurredAt: incomingTime, eventKey: incoming.eventKey };
  }

  const interests = new Set(lead.interests);
  for (const interest of incoming.interests) {
    if (interest.trim()) interests.add(interest);
    if (interests.size >= 100) break;
  }
  const mergedInterests = [...interests].slice(0, 100);
  if (JSON.stringify(mergedInterests) !== JSON.stringify(lead.interests)) {
    lead.interests = mergedInterests;
    changedFields.push('interests');
  }

  return { lead, changedFields };
}

function asProvenance(value: unknown): FieldProvenance | null {
  if (!value || typeof value !== 'object') return null;
  const provenance = value as Partial<FieldProvenance>;
  if (typeof provenance.occurredAt !== 'string' || typeof provenance.eventKey !== 'string')
    return null;
  return { occurredAt: provenance.occurredAt, eventKey: provenance.eventKey };
}

function incomingWins(occurredAt: string, eventKey: string, prior: FieldProvenance): boolean {
  const incomingTimestamp = Date.parse(occurredAt);
  const priorTimestamp = Date.parse(prior.occurredAt);
  if (incomingTimestamp !== priorTimestamp) return incomingTimestamp > priorTimestamp;
  return eventKey.localeCompare(prior.eventKey) < 0;
}
