import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { CountryCode } from 'libphonenumber-js/max';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function normalizeText(
  value: unknown,
  maxLength: number,
): { value: string | null; truncated: boolean } {
  if (typeof value !== 'string') return { value: null, truncated: false };
  const normalized = Array.from(value.normalize('NFC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character;
  })
    .join('')
    .trim();
  if (!normalized) return { value: null, truncated: false };
  const characters = Array.from(normalized);
  return {
    value: characters.length > maxLength ? characters.slice(0, maxLength).join('') : normalized,
    truncated: characters.length > maxLength,
  };
}

export function normalizeEmail(value: unknown): string | null {
  const text = valueWithinLimit(value, 254);
  if (!text) return null;
  const email = text.toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizePhone(value: unknown, region: string): string | null {
  const text = valueWithinLimit(value, 32);
  if (!text) return null;
  try {
    const phone = parsePhoneNumberFromString(text, {
      defaultCountry: region.trim().toUpperCase() as CountryCode,
      extract: false,
    });
    return phone?.isValid() ? phone.number : null;
  } catch {
    return null;
  }
}

function valueWithinLimit(value: unknown, maxLength: number): string | null {
  const normalized = normalizeText(value, Number.MAX_SAFE_INTEGER).value;
  if (!normalized || Array.from(normalized).length > maxLength) return null;
  return normalized;
}
