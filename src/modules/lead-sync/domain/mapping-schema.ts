import { z } from 'zod';

import { DEDUPE_KEYS, FIELD_TYPES, SPECIAL_FIELDS, TECHNICAL_COLUMNS } from '../constants/index.js';
import { LeadSyncMappingError } from '../errors/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import type { LeadMapping } from '../types/index.js';

const { MAPPING } = LEAD_SYNC_MESSAGES;

const scalar = z.union([z.string(), z.number()]);

const fieldSchema = z.strictObject({
  column: z.string().trim().min(1),
  field: z.string().trim().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  values: z.record(z.string(), scalar).optional(),
  default: scalar.optional(),
  onUnknown: z.enum(['error', 'default']).default('error'),
});

const mappingSchema = z
  .strictObject({
    version: z.literal(1),
    sheet: z.strictObject({ headerRow: z.number().int().min(1).default(1) }).default({
      headerRow: 1,
    }),
    titleTemplate: z.string().trim().min(1).optional(),
    defaults: z.record(z.string(), scalar).default({}),
    dedupe: z
      .strictObject({
        keys: z.array(z.enum(DEDUPE_KEYS)).min(1),
        requireAtLeastOne: z.boolean().default(true),
      })
      .default({ keys: [...DEDUPE_KEYS], requireAtLeastOne: true }),
    fields: z.array(fieldSchema).min(1),
  })
  .superRefine((mapping, context) => {
    const problem = (message: string): void => {
      context.addIssue({ code: 'custom', message });
    };
    const columns = new Set<string>();
    const fields = new Set<string>();
    for (const field of mapping.fields) {
      if (columns.has(field.column)) problem(MAPPING.DUPLICATE_COLUMN(field.column));
      if (fields.has(field.field)) problem(MAPPING.DUPLICATE_FIELD(field.field));
      columns.add(field.column);
      fields.add(field.field);
      if (field.type === 'enum' && !field.values) problem(MAPPING.ENUM_VALUES(field.column));
      if ((TECHNICAL_COLUMNS as readonly string[]).includes(field.column)) {
        problem(MAPPING.TECHNICAL_COLUMN(field.column));
      }
    }
    for (const key of mapping.dedupe.keys) {
      if (!fields.has(key)) problem(MAPPING.DEDUPE_KEY_UNMAPPED(key));
    }
  });

/** Structural check of `mapping.json`. Throws LeadSyncMappingError listing every problem. */
export function parseMapping(raw: unknown): LeadMapping {
  const parsed = mappingSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LeadSyncMappingError(
      parsed.error.issues.map((issue) =>
        issue.code === 'custom' || !issue.path.length
          ? issue.message
          : `${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }
  return parsed.data;
}

/**
 * Second check, against reality: every mapped column must be in the header row of the Sheet and
 * every lead field must be known to `crm.item.fields`. Returns the problems, empty when fine.
 */
export function checkMapping(
  mapping: LeadMapping,
  headers: readonly string[],
  leadFields: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];

  const templateColumns = [...(mapping.titleTemplate ?? '').matchAll(/\{([^}]+)\}/g)].map((match) =>
    match[1].trim(),
  );
  const columns = new Set([...mapping.fields.map((field) => field.column), ...templateColumns]);
  for (const column of columns) {
    if (!headers.includes(column)) problems.push(MAPPING.COLUMN_MISSING(column));
  }

  const fields = new Set([
    ...mapping.fields.map((field) => field.field),
    ...Object.keys(mapping.defaults),
  ]);
  for (const field of fields) {
    if (!SPECIAL_FIELDS.includes(field) && !leadFields.has(field)) {
      problems.push(MAPPING.FIELD_UNKNOWN(field));
    }
  }
  return problems;
}
