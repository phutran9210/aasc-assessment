import { createHash } from 'node:crypto';

import { HASH_KIND } from '../constants/index.js';
import type { HashKind } from '../constants/index.js';
import type { LeadMapping } from '../types/index.js';

/** JSON with object keys sorted and `undefined` values dropped: equal data gives equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Part of every row hash, so editing the mapping re-syncs every row on the next run. */
export function hashMapping(mapping: LeadMapping): string {
  return sha256(canonicalJson(mapping));
}

export function hashRow(payload: unknown, mappingHash: string): string {
  return sha256(canonicalJson({ mapping: mappingHash, payload }));
}

export function formatHashCell(kind: HashKind, hash: string): string {
  return `${kind}:${hash}`;
}

/** Reads a `Sync Hash` cell; anything that is not `v1:<hash>` or `invalid:<hash>` is "no hash". */
export function parseHashCell(cell: string): { kind: HashKind; hash: string } | null {
  const [kind, hash, ...rest] = cell.trim().split(':');
  if (rest.length || !hash) return null;
  if (kind !== HASH_KIND.SYNCED && kind !== HASH_KIND.INVALID) return null;
  return { kind, hash };
}
