/**
 * Generates samples/leads-150.csv: deterministic test data for the performance scenario.
 * Usage: node scripts/lead-sync/generate-leads-csv.js [count]
 */
import { writeFileSync } from 'node:fs';

const count = Number(process.argv[2] ?? 150);
const sources = ['facebook', 'google', 'zalo', 'referral', 'website'];
const stages = ['Mới', 'Đang liên hệ', 'Đã xử lý'];

const header = [
  'Tên khách hàng',
  'Email',
  'Số điện thoại',
  'Công ty',
  'Nguồn lead (UTM Source)',
  'Ngân sách dự kiến',
  'Trạng thái',
  'Người phụ trách',
  'Ghi chú',
];

const rows = Array.from({ length: count }, (_unused, index) => {
  const n = index + 1;
  return [
    `Khách hàng ${n}`,
    `khach${n}@example.com`,
    // Imported into Sheets these become numbers and lose the leading zero, on purpose.
    `09${String(n).padStart(8, '0')}`,
    `Công ty ${n}`,
    sources[index % sources.length],
    String(1_000_000 * ((index % 20) + 1)),
    stages[index % stages.length],
    '',
    `Dữ liệu thử nghiệm ${n}`,
  ];
});

const escape = (cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);
const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');

writeFileSync(new URL('../../samples/leads-150.csv', import.meta.url), `${csv}\n`);
console.log(`Wrote ${count} rows to samples/leads-150.csv`);
