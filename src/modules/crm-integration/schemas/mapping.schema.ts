import { z } from 'zod';

export const mappingTransformSchema = z.enum(['trim', 'lowercase', 'uppercase', 'nfc']);

export const mappingEntrySchema = z.strictObject({
  source: z.string().trim().min(1).max(300),
  target: z.string().trim().min(1).max(128),
  subfield: z.enum(['EMAIL', 'PHONE', 'IM', 'WEB']).optional(),
  transforms: z.array(mappingTransformSchema).max(8).default([]),
  owner: z.enum(['integration', 'manual']),
});

export const mappingSchema = z.strictObject({
  entries: z.array(mappingEntrySchema).min(1).max(100),
});

export type MappingConfig = z.infer<typeof mappingSchema>;
