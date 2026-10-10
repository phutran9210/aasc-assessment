import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExportWriter } from '../services/export-writers.js';
import type { ExportRow } from '../domain/export-row.js';

const row: ExportRow = {
  localLeadId: 'lead-1',
  remoteLeadId: null,
  name: '=1+1',
  email: null,
  phone: '+84901234567',
  campaignId: null,
  campaignName: null,
  adId: null,
  adName: null,
  formId: null,
  formName: null,
  receivedAt: '2026-01-01T00:00:00.000Z',
  score: 7,
  syncStatus: 'synced',
  remoteDealId: null,
  pipelineId: null,
  stageId: null,
  assignedTo: null,
  amount: '123.45',
  currency: 'VND',
  convertedAt: null,
};

describe('streaming export writers', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aasc-export-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes CSV headers, escaped cells and an empty export', async () => {
    const path = join(directory, 'leads.csv');
    const writer = createExportWriter('csv', path);
    await writer.write([row]);
    await writer.write([]);
    await writer.close();
    const text = await readFile(path, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("'=1+1");
    expect(text).toContain('+84901234567');
  });

  it('writes valid JSON for populated and empty exports', async () => {
    const populated = createExportWriter('json', join(directory, 'leads.json'));
    await populated.write([row]);
    await populated.close();
    expect(JSON.parse(await readFile(join(directory, 'leads.json'), 'utf8'))).toEqual([row]);

    const empty = createExportWriter('json', join(directory, 'empty.json'));
    await empty.close();
    expect(await readFile(join(directory, 'empty.json'), 'utf8')).toBe('[]\n');
  });

  it('writes an XLSX workbook and releases a partial workbook on abort', async () => {
    const path = join(directory, 'leads.xlsx');
    const writer = createExportWriter('xlsx', path);
    await writer.write([row]);
    await writer.close();
    expect((await readFile(path)).byteLength).toBeGreaterThan(100);

    const partial = createExportWriter('xlsx', join(directory, 'partial.xlsx'));
    await partial.write([row]);
    await partial.abort();
  });
});
