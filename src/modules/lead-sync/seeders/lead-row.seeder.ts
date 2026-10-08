import { faker } from '@faker-js/faker/locale/vi';

import type { LeadMapping } from '../types/index.js';
import { SEED_EMAIL_DOMAIN } from './seed-marker.js';

export type SeedRowsOptions = {
  count: number;
  /** 1-based number of the first row: keeps emails and phones unique across several seeds. */
  startIndex?: number;
  /** Fixes the random generator so the same data is produced on every run. */
  seed?: number;
};

const UTM_SOURCES = ['facebook', 'google', 'zalo', 'referral', 'website', 'tiktok'];

/** The formats sales people really type; every one of them must survive normalization. */
const BUDGET_FORMATS: ReadonlyArray<(amount: number) => string> = [
  (amount) => String(amount),
  (amount) => `${amount.toLocaleString('vi-VN')} ₫`,
  (amount) => `${amount / 1_000_000}tr`,
  (amount) => `${amount / 1000}k`,
  () => '',
];

const PHONE_FORMATS: ReadonlyArray<(digits: string) => string> = [
  (digits) => `0${digits}`,
  (digits) => `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`,
  (digits) => `+84 ${digits}`,
  (digits) => `+84${digits}`,
];

const NOTES: ReadonlyArray<() => string> = [
  () =>
    `Khách ở ${faker.location.city()}, hẹn gọi lại sau ${faker.number.int({ min: 9, max: 17 })}h`,
  () => `Được ${faker.person.fullName()} giới thiệu`,
  () =>
    `Quan tâm gói doanh nghiệp, cần báo giá cho ${faker.number.int({ min: 5, max: 200 })} người dùng`,
  () => `Đã gặp tại sự kiện ở ${faker.location.city()}`,
  () => '',
];

const asciiSlug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');

/**
 * Realistic Vietnamese lead rows for trying the sync with a lot of data. Returns one record per
 * row, keyed by Sheet column, for exactly the columns of `mapping`. Names, companies and notes
 * are random; email and phone are derived from the row number, so they never repeat.
 */
export function buildLeadRows(
  mapping: LeadMapping,
  options: SeedRowsOptions,
): Record<string, string>[] {
  if (options.seed !== undefined) faker.seed(options.seed);
  const start = options.startIndex ?? 1;
  const stageLabels = Object.keys(
    mapping.fields.find((field) => field.field === 'stageId')?.values ?? {},
  );

  return Array.from({ length: options.count }, (_unused, offset) => {
    const n = start + offset;
    const name = faker.person.fullName();
    // 08 + eight digits: a valid mobile shape that the sample files (09...) do not use.
    const phoneDigits = `8${String(n).padStart(8, '0')}`;
    const amount = faker.number.int({ min: 1, max: 200 }) * 500_000;

    const byField: Record<string, string> = {
      name,
      email: `${asciiSlug(name)}.${n}@${SEED_EMAIL_DOMAIN}`,
      phone: faker.helpers.arrayElement(PHONE_FORMATS)(phoneDigits),
      companyTitle: faker.company.name(),
      utmSource: faker.helpers.arrayElement(UTM_SOURCES),
      opportunity: faker.helpers.arrayElement(BUDGET_FORMATS)(amount),
      stageId: stageLabels.length ? faker.helpers.arrayElement(stageLabels) : '',
      comments: faker.helpers.arrayElement(NOTES)(),
    };
    return Object.fromEntries(
      mapping.fields.map((field) => [field.column, byField[field.field] ?? '']),
    );
  });
}
