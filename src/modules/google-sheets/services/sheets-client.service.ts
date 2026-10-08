import { backoffDelayMs, sleep } from '@common/utils/index.js';
import { googleConfig } from '@config/index.js';
import type { GoogleConfig } from '@config/index.js';

import type { sheets_v4 } from '@googleapis/sheets';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { SheetsRequestKind } from '../constants/index.js';
import { SheetsError, toSheetsError } from '../errors/sheets.error.js';
import { GOOGLE_SHEETS_MESSAGES } from '../messages/index.js';
import { GoogleAuthProvider } from './google-auth.provider.js';
import { SheetsRateLimiter } from './sheets-rate-limiter.service.js';

export type SheetMeta = {
  sheetId: number;
  title: string;
  timeZone: string;
  rowCount: number;
  columnCount: number;
};

export type ValueRender = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE';
export type SheetCell = string | number | boolean;
export type ValueRangeInput = { range: string; values: SheetCell[][] };
export type SheetStructureRequest = sheets_v4.Schema$Request;

type CallOptions = { timeout: number };

const META_FIELDS =
  'properties.timeZone,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))';

/**
 * The only place that talks to Google. Every call goes through the rate limiter, has a timeout,
 * is retried with exponential backoff on 429/5xx/network failures, and fails with a SheetsError.
 */
@Injectable()
export class SheetsClient {
  private readonly logger = new Logger(SheetsClient.name);

  constructor(
    private readonly auth: GoogleAuthProvider,
    private readonly limiter: SheetsRateLimiter,
    @Inject(googleConfig.KEY) private readonly config: GoogleConfig,
  ) {}

  /** Finds the configured worksheet and returns its grid id, size and the spreadsheet time zone. */
  async getSheetMeta(): Promise<SheetMeta> {
    const response = await this.send('read', (api, options) =>
      api.spreadsheets.get({ spreadsheetId: this.spreadsheetId, fields: META_FIELDS }, options),
    );
    const name = this.config.sheetName;
    const sheet = response.data.sheets?.find((item) => item.properties?.title === name)?.properties;
    if (sheet?.sheetId === undefined || sheet.sheetId === null) {
      throw new SheetsError(GOOGLE_SHEETS_MESSAGES.ERROR.WORKSHEET_NOT_FOUND(name), 'not_found');
    }
    return {
      sheetId: sheet.sheetId,
      title: name,
      timeZone: response.data.properties?.timeZone ?? 'UTC',
      rowCount: sheet.gridProperties?.rowCount ?? 0,
      columnCount: sheet.gridProperties?.columnCount ?? 0,
    };
  }

  /** Reads several A1 ranges in one request; one grid (rows of cells) per range, in order. */
  async batchGet(ranges: string[], render: ValueRender): Promise<SheetCell[][][]> {
    const response = await this.send('read', (api, options) =>
      api.spreadsheets.values.batchGet(
        {
          spreadsheetId: this.spreadsheetId,
          ranges,
          majorDimension: 'ROWS',
          valueRenderOption: render,
          dateTimeRenderOption: 'SERIAL_NUMBER',
        },
        options,
      ),
    );
    return (response.data.valueRanges ?? []).map((range) => (range.values ?? []) as SheetCell[][]);
  }

  /**
   * Writes several ranges in one request. Always RAW: USER_ENTERED would turn a hash such as
   * `12e45…` into a number and let text coming from Bitrix24 run as a formula.
   */
  async batchUpdateValues(data: ValueRangeInput[]): Promise<void> {
    if (!data.length) return;
    await this.send('write', (api, options) =>
      api.spreadsheets.values.batchUpdate(
        { spreadsheetId: this.spreadsheetId, requestBody: { valueInputOption: 'RAW', data } },
        options,
      ),
    );
  }

  /** Structural changes: add columns, hide columns. */
  async batchUpdate(requests: SheetStructureRequest[]): Promise<void> {
    if (!requests.length) return;
    await this.send('write', (api, options) =>
      api.spreadsheets.batchUpdate(
        { spreadsheetId: this.spreadsheetId, requestBody: { requests } },
        options,
      ),
    );
  }

  private get spreadsheetId(): string {
    if (!this.config.sheetId) {
      throw new SheetsError(GOOGLE_SHEETS_MESSAGES.ERROR.SHEET_ID_MISSING, 'config');
    }
    return this.config.sheetId;
  }

  private async send<T>(
    kind: SheetsRequestKind,
    call: (api: sheets_v4.Sheets, options: CallOptions) => Promise<T>,
  ): Promise<T> {
    const api = this.auth.getApi();
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire(kind);
      try {
        return await call(api, { timeout: this.config.timeoutMs });
      } catch (error) {
        const mapped = toSheetsError(error);
        if (!mapped.retryable || attempt >= this.config.maxRetries) throw mapped;
        const delayMs = backoffDelayMs(attempt, this.config.retryBaseDelayMs);
        this.logger.warn(`Google Sheets ${kind} failed (${mapped.kind}), retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }
}
