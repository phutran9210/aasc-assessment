import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';

import { Inject, Injectable } from '@nestjs/common';

import { parseMapping } from '../domain/mapping-schema.js';
import { hashMapping } from '../domain/sync-hash.js';
import { LeadSyncConfigError } from '../errors/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import type { LeadMapping } from '../types/index.js';

export type LoadedMapping = { mapping: LeadMapping; hash: string };

/** Reads and validates `mapping.json` at the start of every run, and saves an edited one. */
@Injectable()
export class MappingLoader {
  constructor(@Inject(leadSyncConfig.KEY) private readonly config: LeadSyncConfig) {}

  async load(): Promise<LoadedMapping> {
    const path = this.config.mappingPath;
    let text: string;
    try {
      text = await readFile(resolve(path), 'utf8');
    } catch {
      throw new LeadSyncConfigError(LEAD_SYNC_MESSAGES.ERROR.MAPPING_FILE(path));
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new LeadSyncConfigError(LEAD_SYNC_MESSAGES.ERROR.MAPPING_JSON(path));
    }

    const mapping = parseMapping(raw);
    return { mapping, hash: hashMapping(mapping) };
  }

  /**
   * Validates `raw` and replaces the mapping file with it. The content goes to a temporary file
   * first and is then renamed over the old one, so a run that starts meanwhile reads either the
   * old mapping or the new one, never half a file. Throws LeadSyncMappingError when `raw` is not
   * a valid mapping; the file is then left as it was.
   */
  async save(raw: unknown): Promise<LoadedMapping> {
    const mapping = parseMapping(raw);
    const path = resolve(this.config.mappingPath);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
      await rename(temporary, path);
    } catch {
      await rm(temporary, { force: true });
      throw new LeadSyncConfigError(
        LEAD_SYNC_MESSAGES.ERROR.MAPPING_WRITE(this.config.mappingPath),
      );
    }
    return { mapping, hash: hashMapping(mapping) };
  }
}
