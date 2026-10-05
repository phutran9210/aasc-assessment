import { Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { TASK_STATUSES } from '../constants/index.js';
import type { Task } from '../entities/task.entity.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { TaskService } from '../services/task.service.js';

const TASK_ID = '0199a1b2-c3d4-7e5f-8a6b-0123456789ab';

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    title: 'Viết báo cáo',
    description: 'Báo cáo tuần',
    status: TASK_STATUSES.TODO,
    createdAt: new Date('2026-10-04T15:00:00.000Z'),
    updatedAt: new Date('2026-10-04T16:00:00.000Z'),
    ...overrides,
  } as Task;
}

describe('TaskService', () => {
  let service: TaskService;
  const taskRepository = {
    create: jest.fn(),
    findById: jest.fn(),
    findPage: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      providers: [TaskService, { provide: TaskRepository, useValue: taskRepository }],
    }).compile();

    service = moduleRef.get(TaskService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    it('should persist the dto and return the response shape when the dto is valid', async () => {
      const task = createMockTask();
      taskRepository.create.mockResolvedValue(task);

      const result = await service.create({ title: 'Viết báo cáo', description: 'Báo cáo tuần' });

      expect(taskRepository.create).toHaveBeenCalledWith({
        title: 'Viết báo cáo',
        description: 'Báo cáo tuần',
        status: undefined,
      });
      expect(result).toEqual({
        id: TASK_ID,
        title: 'Viết báo cáo',
        description: 'Báo cáo tuần',
        status: 'To Do',
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
    });

    it.each([[undefined], [null], ['']])(
      'should store description as null when it is %p',
      async (description) => {
        taskRepository.create.mockResolvedValue(createMockTask({ description: null }));

        await service.create({ title: 'x', description });

        expect(taskRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({ description: null }),
        );
      },
    );
  });

  describe('findAll', () => {
    it('should return list items and pagination meta when tasks exist', async () => {
      taskRepository.findPage.mockResolvedValue({ tasks: [createMockTask()], total: 41 });

      const result = await service.findAll({ page: 3, limit: 20, status: TASK_STATUSES.TODO });

      expect(taskRepository.findPage).toHaveBeenCalledWith({ page: 3, limit: 20, status: 'To Do' });
      expect(result.meta).toEqual({ total: 41, page: 3, limit: 20, totalPages: 3 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('updatedAt');
      expect(result.data[0]).toEqual(expect.objectContaining({ id: TASK_ID, status: 'To Do' }));
    });

    it('should return an empty page when there are no tasks', async () => {
      taskRepository.findPage.mockResolvedValue({ tasks: [], total: 0 });

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toEqual({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
    });
  });

  describe('findOne', () => {
    it('should return the task response when the task exists', async () => {
      taskRepository.findById.mockResolvedValue(createMockTask());

      const result = await service.findOne(TASK_ID);

      expect(taskRepository.findById).toHaveBeenCalledWith(TASK_ID);
      expect(result).toEqual(expect.objectContaining({ id: TASK_ID, title: 'Viết báo cáo' }));
    });

    it('should throw NotFoundException when the task does not exist', async () => {
      taskRepository.findById.mockResolvedValue(null);

      const result = service.findOne(TASK_ID);

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Task không tồn tại');
    });
  });

  describe('update', () => {
    it('should change only the provided fields when the dto is partial', async () => {
      taskRepository.findById.mockResolvedValue(createMockTask());
      taskRepository.save.mockImplementation((task: Task) => Promise.resolve(task));

      const result = await service.update(TASK_ID, { status: TASK_STATUSES.DONE });

      expect(taskRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Viết báo cáo',
          description: 'Báo cáo tuần',
          status: 'Done',
        }),
      );
      expect(result.status).toBe('Done');
    });

    it('should clear the description when the dto sets it to null', async () => {
      taskRepository.findById.mockResolvedValue(createMockTask());
      taskRepository.save.mockImplementation((task: Task) => Promise.resolve(task));

      const result = await service.update(TASK_ID, { description: null });

      expect(result.description).toBeNull();
      expect(result.title).toBe('Viết báo cáo');
    });

    it('should throw NotFoundException and save nothing when the task does not exist', async () => {
      taskRepository.findById.mockResolvedValue(null);

      await expect(service.update(TASK_ID, { title: 'x' })).rejects.toThrow(NotFoundException);
      expect(taskRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove the task when it exists', async () => {
      const task = createMockTask();
      taskRepository.findById.mockResolvedValue(task);

      await service.remove(TASK_ID);

      expect(taskRepository.remove).toHaveBeenCalledWith(task);
    });

    it('should throw NotFoundException and remove nothing when the task does not exist', async () => {
      taskRepository.findById.mockResolvedValue(null);

      await expect(service.remove(TASK_ID)).rejects.toThrow(NotFoundException);
      expect(taskRepository.remove).not.toHaveBeenCalled();
    });
  });
});
