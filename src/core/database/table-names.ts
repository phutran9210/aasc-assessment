/**
 * Single source of truth for table names (snake_case).
 * Every feature adds its table here and uses `@Entity(TABLE_NAMES.X)` — never a raw string.
 */
export const TABLE_NAMES = {
  BITRIX_INSTALLATION: 'bitrix_installation',
  CARO_MATCH: 'caro_match',
  JOTFORM_SUBMISSION: 'jotform_submission',
  LINE98_GAME: 'line98_game',
  TASK: 'task',
  USER: 'user',
} as const satisfies Record<string, string>;
