import type { GoogleConfig } from '@config/index.js';

import { SheetsError } from '../errors/sheets.error.js';
import type { GoogleAuthProvider } from '../services/google-auth.provider.js';
import { SheetsClient } from '../services/sheets-client.service.js';
import { SheetsRateLimiter } from '../services/sheets-rate-limiter.service.js';

const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

const config: GoogleConfig = {
  authMode: 'service_account',
  serviceAccountKeyFile: undefined,
  serviceAccountKeyBase64: 'unused',
  oauthClientId: undefined,
  oauthClientSecret: undefined,
  oauthRedirectUri: undefined,
  oauthTokenFile: 'secrets/google-oauth-token.json',
  sheetId: SHEET_ID,
  sheetName: 'Leads',
  timeoutMs: 30_000,
  maxRetries: 2,
  retryBaseDelayMs: 0,
};

const httpError = (status: number, message = 'error'): Error =>
  Object.assign(new Error(message), { status, response: { status } });

describe('SheetsClient', () => {
  const api = {
    spreadsheets: {
      get: jest.fn(),
      batchUpdate: jest.fn(),
      values: { batchGet: jest.fn(), batchUpdate: jest.fn() },
    },
  };
  const auth = { getApi: jest.fn() };
  let client: SheetsClient;

  beforeEach(() => {
    jest.resetAllMocks();
    auth.getApi.mockReturnValue(api);
    client = new SheetsClient(
      auth as unknown as GoogleAuthProvider,
      new SheetsRateLimiter(),
      config,
    );
  });

  it('should read the metadata of the configured worksheet', async () => {
    api.spreadsheets.get.mockResolvedValue({
      data: {
        properties: { timeZone: 'Asia/Ho_Chi_Minh' },
        sheets: [
          { properties: { sheetId: 1, title: 'Khác' } },
          {
            properties: {
              sheetId: 77,
              title: 'Leads',
              gridProperties: { rowCount: 1000, columnCount: 14 },
            },
          },
        ],
      },
    });

    await expect(client.getSheetMeta()).resolves.toEqual({
      sheetId: 77,
      title: 'Leads',
      timeZone: 'Asia/Ho_Chi_Minh',
      rowCount: 1000,
      columnCount: 14,
    });
    expect(api.spreadsheets.get).toHaveBeenCalledWith(
      expect.objectContaining({ spreadsheetId: SHEET_ID, fields: expect.any(String) }),
      { timeout: 30_000 },
    );
  });

  it('should fail with kind "not_found" when the worksheet does not exist', async () => {
    api.spreadsheets.get.mockResolvedValue({ data: { sheets: [{ properties: { title: 'X' } }] } });

    await expect(client.getSheetMeta()).rejects.toMatchObject({
      kind: 'not_found',
      message: 'Spreadsheet không có worksheet tên "Leads"; kiểm tra GOOGLE_SHEET_NAME',
    });
  });

  it('should read ranges with the requested render option and serial-number dates', async () => {
    api.spreadsheets.values.batchGet.mockResolvedValue({
      data: { valueRanges: [{ values: [['a', 1]] }, {}] },
    });

    await expect(
      client.batchGet(["'Leads'", "'Leads'!B2:B9"], 'UNFORMATTED_VALUE'),
    ).resolves.toEqual([[['a', 1]], []]);
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledWith(
      {
        spreadsheetId: SHEET_ID,
        ranges: ["'Leads'", "'Leads'!B2:B9"],
        majorDimension: 'ROWS',
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      },
      { timeout: 30_000 },
    );
  });

  it('should always write values as RAW, so text is never turned into a formula or a number', async () => {
    api.spreadsheets.values.batchUpdate.mockResolvedValue({ data: {} });
    const data = [{ range: "'Leads'!K2", values: [['=HYPERLINK("x")']] }];

    await client.batchUpdateValues(data);

    expect(api.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(
      { spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'RAW', data } },
      { timeout: 30_000 },
    );
  });

  it('should send nothing for an empty write', async () => {
    await client.batchUpdateValues([]);
    await client.batchUpdate([]);

    expect(api.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    expect(api.spreadsheets.batchUpdate).not.toHaveBeenCalled();
  });

  it('should send structural requests through spreadsheets.batchUpdate', async () => {
    api.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
    const requests = [{ appendDimension: { sheetId: 77, dimension: 'COLUMNS', length: 2 } }];

    await client.batchUpdate(requests);

    expect(api.spreadsheets.batchUpdate).toHaveBeenCalledWith(
      { spreadsheetId: SHEET_ID, requestBody: { requests } },
      { timeout: 30_000 },
    );
  });

  it('should retry a 429 and then succeed', async () => {
    api.spreadsheets.values.batchGet
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { valueRanges: [{ values: [['ok']] }] } });

    await expect(client.batchGet(["'Leads'"], 'FORMATTED_VALUE')).resolves.toEqual([[['ok']]]);
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(3);
  });

  it('should give up after maxRetries and report the last error', async () => {
    api.spreadsheets.values.batchGet.mockRejectedValue(httpError(429));

    await expect(client.batchGet(["'Leads'"], 'FORMATTED_VALUE')).rejects.toMatchObject({
      kind: 'rate_limit',
      retryable: true,
    });
    // One first attempt + maxRetries (2).
    expect(api.spreadsheets.values.batchGet).toHaveBeenCalledTimes(3);
  });

  it('should not retry a permission error', async () => {
    api.spreadsheets.get.mockRejectedValue(httpError(403, 'The caller does not have permission'));

    await expect(client.getSheetMeta()).rejects.toMatchObject({ kind: 'auth' });
    expect(api.spreadsheets.get).toHaveBeenCalledTimes(1);
  });

  it('should surface a configuration error without calling Google', async () => {
    auth.getApi.mockImplementation(() => {
      throw new SheetsError('Chưa cấu hình GOOGLE_SHEET_ID', 'config');
    });

    await expect(client.getSheetMeta()).rejects.toMatchObject({ kind: 'config' });
    expect(api.spreadsheets.get).not.toHaveBeenCalled();
  });
});
