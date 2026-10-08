import { columnIndex, columnLetter, quoteSheetName } from '../domain/a1.js';

describe('a1', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('should convert column index %i to %s and back', (index, letters) => {
    expect(columnLetter(index)).toBe(letters);
    expect(columnIndex(letters)).toBe(index);
  });

  it('should quote a sheet name and double the quotes inside it', () => {
    expect(quoteSheetName('Leads')).toBe("'Leads'");
    expect(quoteSheetName("Khách hàng 'VIP'")).toBe("'Khách hàng ''VIP'''");
  });
});
