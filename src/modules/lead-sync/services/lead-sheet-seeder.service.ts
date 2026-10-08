import { SheetsClient } from '@modules/google-sheets/index.js';
import type { SheetStructureRequest } from '@modules/google-sheets/index.js';

import { Injectable } from '@nestjs/common';

import { SHEET_COLUMNS } from '../constants/index.js';
import { columnLetter, quoteSheetName } from '../domain/a1.js';
import { LeadSyncConfigError } from '../errors/index.js';
import { BitrixLeadGateway } from '../gateways/bitrix-lead.gateway.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import { buildLeadRows, isSeededEmail } from '../seeders/lead-row.seeder.js';
import { MappingLoader } from './mapping-loader.service.js';
import { SheetTable } from './sheet-table.service.js';
import type { SheetSnapshot } from './sheet-table.service.js';

export type SeedOutcome = { added: number; firstRow: number; lastRow: number };
export type ClearOutcome = { rows: number; leads: number };

/**
 * Test data for the lead sync: appends generated rows to the worksheet, and removes them again
 * together with the leads they produced. Only rows whose email is on the seed domain are ever
 * removed, so real rows of the same worksheet are safe.
 */
@Injectable()
export class LeadSheetSeeder {
  constructor(
    private readonly client: SheetsClient,
    private readonly table: SheetTable,
    private readonly mappingLoader: MappingLoader,
    private readonly gateway: BitrixLeadGateway,
  ) {}

  /** Appends `count` rows under the last row that has data. */
  async seed(count: number, seed?: number): Promise<SeedOutcome> {
    const { mapping } = await this.mappingLoader.load();
    const snapshot = await this.table.load(mapping);
    const missing = mapping.fields
      .map((field) => field.column)
      .filter((column) => !(column in snapshot.columns));
    if (missing.length) {
      throw new LeadSyncConfigError(LEAD_SYNC_MESSAGES.MAPPING.COLUMN_MISSING(missing[0]));
    }

    const firstRow = Math.max(snapshot.headerRow, ...snapshot.rows.map((row) => row.rowNumber)) + 1;
    const lastRow = firstRow + count - 1;
    if (lastRow > snapshot.meta.rowCount) {
      await this.client.batchUpdate([
        {
          appendDimension: {
            sheetId: snapshot.meta.sheetId,
            dimension: 'ROWS',
            length: lastRow - snapshot.meta.rowCount,
          },
        },
      ]);
    }

    const rows = buildLeadRows(mapping, {
      count,
      seed,
      startIndex: this.seededRows(snapshot).length + 1,
    });
    const sheet = quoteSheetName(snapshot.meta.title);
    // One range per column: columns are found by header, so they need not be next to each other.
    await this.client.batchUpdateValues(
      mapping.fields.map((field) => {
        const letter = columnLetter(snapshot.columns[field.column]);
        return {
          range: `${sheet}!${letter}${firstRow}:${letter}${lastRow}`,
          values: rows.map((row) => [row[field.column] ?? '']),
        };
      }),
    );
    return { added: count, firstRow, lastRow };
  }

  /** Deletes every seeded row, and first the Bitrix24 leads those rows are linked to. */
  async clear(): Promise<ClearOutcome> {
    const { mapping } = await this.mappingLoader.load();
    const snapshot = await this.table.load(mapping);
    const seeded = this.seededRows(snapshot);
    if (!seeded.length) return { rows: 0, leads: 0 };

    const leadIds = seeded
      .map((row) => row.state.leadId)
      .filter((id) => /^\d+$/.test(id))
      .map(Number);
    await this.gateway.deleteLeads(leadIds);

    await this.client.batchUpdate(
      deleteRowRequests(
        snapshot.meta.sheetId,
        seeded.map((row) => row.rowNumber),
      ),
    );
    return { rows: seeded.length, leads: leadIds.length };
  }

  private seededRows(snapshot: SheetSnapshot): SheetSnapshot['rows'] {
    const emailColumns = Object.keys(snapshot.columns).filter(
      (column) => !(Object.values(SHEET_COLUMNS) as string[]).includes(column),
    );
    return snapshot.rows.filter((row) =>
      emailColumns.some((column) => isSeededEmail(row.cells[column]?.formatted ?? '')),
    );
  }
}

/**
 * One request per run of neighbouring rows, bottom run first: deleting from the bottom keeps the
 * numbers of the rows above valid.
 */
function deleteRowRequests(sheetId: number, rowNumbers: number[]): SheetStructureRequest[] {
  const sorted = [...rowNumbers].sort((a, b) => b - a);
  const requests: SheetStructureRequest[] = [];
  let end = sorted[0];
  let start = end;
  const flush = (): void => {
    requests.push({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: start - 1, endIndex: end },
      },
    });
  };
  for (const rowNumber of sorted.slice(1)) {
    if (rowNumber === start - 1) {
      start = rowNumber;
      continue;
    }
    flush();
    end = rowNumber;
    start = rowNumber;
  }
  flush();
  return requests;
}
