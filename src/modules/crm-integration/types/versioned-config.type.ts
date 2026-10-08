import type { CompiledMapping } from '../domain/mapping-compiler.js';

export type VersionedConfig = {
  key: string;
  revision: number;
  etag: string;
  value: Record<string, unknown>;
  compiled?: CompiledMapping | null;
};
