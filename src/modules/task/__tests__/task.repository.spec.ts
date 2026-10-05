import { DataSource } from 'typeorm';

import { TASK_STATUSES } from '../constants/index.js';
import { Task } from '../entities/task.entity.js';
import { TaskRepository } from '../repositories/task.repository.js';

describe('TaskRepository', () => {
  let dataSource: DataSource;
  let repository: TaskRepository;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Task],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = new TaskRepository(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  describe('create', () => {
    it('should default status to "To Do" and description to null when they are omitted', async () => {
      const created = await repository.create({ title: 'Mặc định' });

      const stored = await repository.findById(created.id);

      expect(stored).toEqual(
        expect.objectContaining({ title: 'Mặc định', status: 'To Do', description: null }),
      );
    });
  });

  describe('findPage', () => {
    it('should return an empty page when there are no tasks', async () => {
      expect(await repository.findPage({ page: 1, limit: 20 })).toEqual({ tasks: [], total: 0 });
    });

    it('should return newest tasks first when several exist', async () => {
      await repository.create({ title: 'first' });
      await repository.create({ title: 'second' });
      await repository.create({ title: 'third' });

      const { tasks } = await repository.findPage({ page: 1, limit: 20 });

      expect(tasks.map((task) => task.title)).toEqual(['third', 'second', 'first']);
    });

    it('should slice by page and limit while reporting the full total', async () => {
      for (const title of ['t1', 't2', 't3', 't4', 't5']) {
        await repository.create({ title });
      }

      const secondPage = await repository.findPage({ page: 2, limit: 2 });
      const lastPage = await repository.findPage({ page: 3, limit: 2 });
      const beyond = await repository.findPage({ page: 4, limit: 2 });

      expect(secondPage.total).toBe(5);
      expect(secondPage.tasks.map((task) => task.title)).toEqual(['t3', 't2']);
      expect(lastPage.tasks.map((task) => task.title)).toEqual(['t1']);
      expect(beyond).toEqual({ tasks: [], total: 5 });
    });

    it('should return only matching tasks and their count when a status filter is given', async () => {
      await repository.create({ title: 'a', status: TASK_STATUSES.DONE });
      await repository.create({ title: 'b', status: TASK_STATUSES.TODO });
      await repository.create({ title: 'c', status: TASK_STATUSES.DONE });

      const result = await repository.findPage({ page: 1, limit: 20, status: TASK_STATUSES.DONE });

      expect(result.total).toBe(2);
      expect(result.tasks.map((task) => task.title)).toEqual(['c', 'a']);
    });
  });
});
