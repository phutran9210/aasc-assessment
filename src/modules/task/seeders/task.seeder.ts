import { Temporal } from '@common/utils/index.js';

import { faker } from '@faker-js/faker/locale/vi';
import type { DataSource } from 'typeorm';

import { TASK_STATUS_VALUES } from '../constants/index.js';
import { Task } from '../entities/task.entity.js';

export type SeedTasksOptions = {
  /** Number of tasks to create. */
  count?: number;
  /** Fixes the random generator so the same data is produced on every run. */
  seed?: number;
};

const DEFAULT_COUNT = 100;
const CREATED_WITHIN_DAYS = 30;
/** Share of tasks that get a description; the rest keep it NULL like a quick note would. */
const DESCRIPTION_PROBABILITY = 0.8;

/** Vietnamese office tasks; faker fills in the people, companies and places. */
const TITLE_TEMPLATES: ReadonlyArray<() => string> = [
  () => `Gọi điện tư vấn cho khách hàng ${faker.person.fullName()}`,
  () => `Gửi báo giá cho ${faker.company.name()}`,
  () => `Chuẩn bị hợp đồng với ${faker.company.name()}`,
  () => `Khảo sát nhu cầu khách hàng tại ${faker.location.city()}`,
  () => `Họp với ${faker.person.fullName()} về tiến độ dự án`,
  () => `Cập nhật thông tin liên hệ của ${faker.person.fullName()}`,
  () => `Lập báo cáo doanh thu tháng ${faker.number.int({ min: 1, max: 12 })}`,
  () => `Kiểm tra công nợ của ${faker.company.name()}`,
  () => `Xử lý yêu cầu hỗ trợ #${faker.number.int({ min: 1000, max: 9999 })}`,
  () => `Lên lịch demo sản phẩm tại ${faker.location.city()}`,
  () => `Đối soát hóa đơn quý ${faker.number.int({ min: 1, max: 4 })}`,
  () => `Chăm sóc lại khách hàng ${faker.person.fullName()} sau bán hàng`,
];

const DESCRIPTION_TEMPLATES: ReadonlyArray<() => string> = [
  () => `Liên hệ qua số ${faker.phone.number()} trước ${faker.number.int({ min: 9, max: 17 })}h.`,
  () => `Người phụ trách: ${faker.person.fullName()}. Ưu tiên xử lý trong tuần này.`,
  () => `Địa chỉ làm việc: ${faker.location.streetAddress()}, ${faker.location.city()}.`,
  () => `Gửi kết quả về ${faker.internet.email()} sau khi hoàn thành.`,
  () => `Cần xác nhận lại với ${faker.company.name()} trước khi thực hiện.`,
];

const pick = (templates: ReadonlyArray<() => string>): string =>
  faker.helpers.arrayElement(templates)();

/**
 * Replaces every task with `count` realistic Vietnamese tasks (idempotent: safe to run again).
 * Created dates are spread over the last 30 days so that sorting and paging look real.
 */
export async function seedTasks(
  dataSource: DataSource,
  options: SeedTasksOptions = {},
): Promise<void> {
  const { count = DEFAULT_COUNT, seed } = options;
  if (seed !== undefined) faker.seed(seed);

  const repository = dataSource.getRepository(Task);
  await repository.clear();

  const now = new Date(Temporal.Now.instant().epochMilliseconds);
  const tasks = Array.from({ length: count }, () =>
    repository.create({
      title: pick(TITLE_TEMPLATES),
      description: faker.datatype.boolean(DESCRIPTION_PROBABILITY)
        ? pick(DESCRIPTION_TEMPLATES)
        : null,
      status: faker.helpers.arrayElement(TASK_STATUS_VALUES),
      createdAt: faker.date.recent({ days: CREATED_WITHIN_DAYS, refDate: now }),
    }),
  );
  await repository.save(tasks, { chunk: 500 });

  console.log(`  Seeded ${await repository.count()} tasks`);
}
