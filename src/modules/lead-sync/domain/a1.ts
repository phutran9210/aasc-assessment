const LETTERS = 26;
const CODE_A = 65;

/** 0-based column index → A1 letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let letters = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / LETTERS)) {
    letters = String.fromCharCode(CODE_A + ((rest - 1) % LETTERS)) + letters;
  }
  return letters;
}

/** A1 letters → 0-based column index. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * LETTERS + (letter.charCodeAt(0) - CODE_A + 1);
  }
  return index - 1;
}

/** Sheet name as the first part of an A1 range; always quoted, so spaces need no special case. */
export function quoteSheetName(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}
