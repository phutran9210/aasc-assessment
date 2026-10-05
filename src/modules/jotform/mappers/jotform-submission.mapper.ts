import {
  CONTACT_PHONE_PATTERN,
  CONTACT_TEXT_MAX_LENGTH,
} from '@modules/contact/constants/index.js';

import { isEmail } from 'class-validator';

import { JOTFORM_QUESTION_TYPES } from '../constants/index.js';
import { JOTFORM_MESSAGES } from '../messages/index.js';
import type {
  JotformAnswer,
  JotformContactFields,
  JotformSubmissionContent,
} from '../types/index.js';

/** The submission cannot become a contact; `problems` lists every invalid field. */
export class JotformMappingError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
    this.name = 'JotformMappingError';
  }
}

/**
 * Maps a Jotform submission to the three contact fields.
 * Questions are found by type, in form order, so the form can be relabelled or translated
 * without touching the code. The name comes from the Full Name widget, or from the first
 * plain text field when the form uses one instead.
 */
export function toContactFields(submission: JotformSubmissionContent): JotformContactFields {
  const answers = Object.values(submission.answers ?? {}).sort(
    (a, b) => Number(a.order ?? 0) - Number(b.order ?? 0),
  );
  const firstOf = (...types: string[]): JotformAnswer | undefined => {
    for (const type of types) {
      const found = answers.find((answer) => answer.type === type);
      if (found) return found;
    }
    return undefined;
  };

  const name = readName(firstOf(JOTFORM_QUESTION_TYPES.FULL_NAME, JOTFORM_QUESTION_TYPES.TEXT));
  const phone = readPhone(firstOf(JOTFORM_QUESTION_TYPES.PHONE));
  const email = readText(firstOf(JOTFORM_QUESTION_TYPES.EMAIL));

  const problems: string[] = [];
  if (!name || name.length > CONTACT_TEXT_MAX_LENGTH) {
    problems.push(JOTFORM_MESSAGES.VALIDATION.NAME);
  }
  if (!CONTACT_PHONE_PATTERN.test(phone)) problems.push(JOTFORM_MESSAGES.VALIDATION.PHONE);
  if (!isEmail(email)) problems.push(JOTFORM_MESSAGES.VALIDATION.EMAIL);
  if (problems.length) throw new JotformMappingError(problems);

  return { name, phone, email };
}

function readName(question: JotformAnswer | undefined): string {
  const parts = asRecord(question?.answer);
  if (parts) {
    const joined = joinParts(parts.first, parts.middle, parts.last);
    if (joined) return joined;
  }
  return readText(question);
}

function readPhone(question: JotformAnswer | undefined): string {
  const parts = asRecord(question?.answer);
  if (parts) {
    const full = text(parts.full);
    if (full) return full;
    const country = text(parts.country);
    const joined = joinParts(country ? `+${country}` : '', parts.area, parts.phone);
    if (joined) return joined;
  }
  return readText(question);
}

/** A string answer, or Jotform's own rendering of the answer when it is not a string. */
function readText(question: JotformAnswer | undefined): string {
  return text(question?.answer) || text(question?.prettyFormat);
}

function joinParts(...parts: unknown[]): string {
  return parts.map(text).filter(Boolean).join(' ');
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
