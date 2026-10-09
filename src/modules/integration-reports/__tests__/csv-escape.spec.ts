import { CSV_BOM, csvLine, neutralizeCell } from '../domain/csv-escape.js';
import { EXPORT_COLUMNS, toExportRow } from '../domain/export-row.js';
import type { ExportSourceRow } from '../domain/export-row.js';

describe('CSV escaping', () => {
  it.each([
    ['=HYPERLINK("http://evil.test","x")', `'=HYPERLINK("http://evil.test","x")`],
    ['+84901234567', `'+84901234567`],
    ['-2+3', `'-2+3`],
    ['@SUM(A1:A2)', `'@SUM(A1:A2)`],
    ['\t=1+1', `'\t=1+1`],
    ['\r=1+1', `'\r=1+1`],
    ['\n@cmd', `'\n@cmd`],
    ['\u0000=1', `'\u0000=1`],
  ])('neutralizes the formula trigger in %j', (input, expected) => {
    expect(neutralizeCell(input)).toBe(expected);
  });

  it.each(['Nguyễn Văn A', 'a=b', '84901234567', 'user@example.test', '', ' leading space'])(
    'leaves the harmless text %j untouched',
    (input) => {
      expect(neutralizeCell(input)).toBe(input);
    },
  );

  it('quotes delimiters, quotes and line breaks and ends rows with CRLF', () => {
    expect(csvLine(['plain', 'a,b', 'say "hi"', 'two\nlines', null, 42])).toBe(
      'plain,"a,b","say ""hi""","two\nlines",,42\r\n',
    );
  });

  it('neutralizes before quoting so a quoted formula stays inert', () => {
    expect(csvLine(['=1+1,2'])).toBe(`"'=1+1,2"\r\n`);
  });

  it('starts files with a UTF-8 byte order mark for Excel', () => {
    expect(Buffer.from(CSV_BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});

describe('export row', () => {
  const source: ExportSourceRow = {
    localLeadId: '018f0000-0000-7000-8000-000000000001',
    remoteLeadId: '00123',
    name: 'Lead',
    email: 'lead@example.test',
    phone: '+84901234567',
    campaignId: '1790000000000000001',
    campaignName: 'Spring Sale',
    adId: null,
    adName: null,
    formId: 'form-1',
    formName: 'Form',
    receivedAt: new Date('2026-10-01T02:03:04.000Z'),
    score: 85,
    syncStatus: 'synced',
    remoteDealId: '900',
    pipelineId: '1',
    stageId: 'C1:WON',
    assignedTo: '7',
    amount: '1500000.0000',
    currency: 'VND',
    convertedAt: null,
  };

  it('maps a database row to the export DTO without touching IDs or money precision', () => {
    expect(toExportRow(source)).toEqual({
      ...source,
      receivedAt: '2026-10-01T02:03:04.000Z',
      amount: '1500000',
    });
  });

  it('exposes exactly the columns of the report contract and keeps identifiers as text', () => {
    expect(EXPORT_COLUMNS.map((column) => column.key)).toEqual([
      'localLeadId',
      'remoteLeadId',
      'name',
      'email',
      'phone',
      'campaignId',
      'campaignName',
      'adId',
      'adName',
      'formId',
      'formName',
      'receivedAt',
      'score',
      'syncStatus',
      'remoteDealId',
      'pipelineId',
      'stageId',
      'assignedTo',
      'amount',
      'currency',
      'convertedAt',
    ]);
    expect(
      EXPORT_COLUMNS.filter((column) => column.type === 'number').map((column) => column.key),
    ).toEqual(['score']);
  });
});
