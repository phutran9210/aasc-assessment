import { BadRequestException } from '@nestjs/common';

import type { Predicate } from '../types/rule.types.js';

const LEGACY_CONTAINS =
  /^\s*([A-Za-z][A-Za-z0-9_.-]{0,127})\s+CONTAINS\s+"((?:[^"\\]|\\["\\])*)"\s*$/i;

export function parseLegacyCondition(text: string): Predicate {
  const match = LEGACY_CONTAINS.exec(text);
  if (!match) throw new BadRequestException('Unsupported legacy condition syntax');
  return {
    field: match[1],
    op: 'contains',
    value: match[2].replace(/\\(["\\])/g, '$1'),
  };
}
