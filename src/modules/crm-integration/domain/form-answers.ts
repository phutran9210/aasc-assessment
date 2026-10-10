const QUESTION_ALIASES = {
  budget: ['budget', 'budget range', 'ngân sách', 'ngân sách dự kiến'],
  timeline: ['timeline', 'thời gian', 'thời gian dự kiến'],
} as const;

export type KnownQuestion = keyof typeof QUESTION_ALIASES;

/**
 * Answer to a form question the rules and the score know about. Forms identify a question by an
 * ID or only by its text ("Budget range"), so the stored key is matched against both.
 */
export function formAnswer(answers: Record<string, unknown>, question: KnownQuestion): unknown {
  if (Object.hasOwn(answers, question)) return answers[question];
  const aliases: readonly string[] = QUESTION_ALIASES[question];
  const key = Object.keys(answers).find((candidate) =>
    aliases.includes(
      candidate.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi'),
    ),
  );
  return key === undefined ? undefined : answers[key];
}
