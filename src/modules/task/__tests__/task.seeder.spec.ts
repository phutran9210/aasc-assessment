import { DataSource } from 'typeorm';

import { TASK_CONSTRAINTS, TASK_STATUS_VALUES } from '../constants/index.js';
import { Task } from '../entities/task.entity.js';
import { seedTasks } from '../seeders/task.seeder.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('seedTasks', () => {
  let dataSource: DataSource;
  let log: jest.SpyInstance;

  const allTasks = (): Promise<Task[]> => dataSource.getRepository(Task).find();
  const insertExistingTask = async (): Promise<void> => {
    const repository = dataSource.getRepository(Task);
    await repository.save(repository.create({ title: 'Task cũ' }));
  };

  beforeEach(async () => {
    log = jest.spyOn(console, 'log').mockImplementation();
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Task],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
    jest.restoreAllMocks();
  });

  it('should insert exactly the requested number of tasks and report it', async () => {
    await seedTasks(dataSource, { count: 25 });

    expect(await allTasks()).toHaveLength(25);
    expect(log).toHaveBeenCalledWith('  Seeded 25 tasks');
  });

  it('should insert 100 tasks when no count is given', async () => {
    await seedTasks(dataSource);

    expect(await allTasks()).toHaveLength(100);
  });

  it('should generate data that satisfies the same rules as the API', async () => {
    await seedTasks(dataSource, { count: 200 });

    for (const task of await allTasks()) {
      expect(task.title.trim()).toBe(task.title);
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.title.length).toBeLessThanOrEqual(TASK_CONSTRAINTS.TITLE.MAX_LENGTH);
      expect(TASK_STATUS_VALUES).toContain(task.status);
      if (task.description !== null) {
        expect(task.description.length).toBeGreaterThan(0);
        expect(task.description.length).toBeLessThanOrEqual(
          TASK_CONSTRAINTS.DESCRIPTION.MAX_LENGTH,
        );
      }
    }
  });

  it('should cover every status and both tasks with and without description', async () => {
    await seedTasks(dataSource, { count: 200 });
    const tasks = await allTasks();

    expect(new Set(tasks.map((task) => task.status))).toEqual(new Set(TASK_STATUS_VALUES));
    expect(tasks.some((task) => task.description === null)).toBe(true);
    expect(tasks.some((task) => task.description !== null)).toBe(true);
  });

  it('should spread createdAt over the last 30 days and never in the future', async () => {
    const before = Date.now();

    await seedTasks(dataSource, { count: 50 });

    const times = (await allTasks()).map((task) => task.createdAt.getTime());
    expect(Math.max(...times)).toBeLessThanOrEqual(Date.now());
    expect(Math.min(...times)).toBeGreaterThanOrEqual(before - 31 * DAY_MS);
    expect(new Set(times).size).toBeGreaterThan(40);
  });

  it('should replace existing tasks when run again', async () => {
    await insertExistingTask();

    await seedTasks(dataSource, { count: 10 });
    await seedTasks(dataSource, { count: 5 });

    const tasks = await allTasks();
    expect(tasks).toHaveLength(5);
    expect(tasks.map((task) => task.title)).not.toContain('Task cũ');
  });

  it('should produce the same titles when the same seed is given', async () => {
    await seedTasks(dataSource, { count: 20, seed: 42 });
    const first = (await allTasks()).map((task) => task.title).sort();

    await seedTasks(dataSource, { count: 20, seed: 42 });
    const second = (await allTasks()).map((task) => task.title).sort();

    expect(second).toEqual(first);
  });

  it('should leave the table empty when count is 0', async () => {
    await insertExistingTask();

    await seedTasks(dataSource, { count: 0 });

    expect(await allTasks()).toEqual([]);
  });
});
