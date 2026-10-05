import { Test } from '@nestjs/testing';

import { TaskController } from '../controllers/task.controller.js';
import { TaskService } from '../services/task.service.js';
import type { TaskResponse } from '../types/index.js';

const TASK_ID = '0199a1b2-c3d4-7e5f-8a6b-0123456789ab';

const taskResponse: TaskResponse = {
  id: TASK_ID,
  title: 'Viết báo cáo',
  description: null,
  status: 'To Do',
  createdAt: new Date('2026-10-04T15:00:00.000Z'),
  updatedAt: new Date('2026-10-04T15:00:00.000Z'),
};

describe('TaskController', () => {
  let controller: TaskController;
  const taskService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [{ provide: TaskService, useValue: taskService }],
    }).compile();

    controller = moduleRef.get(TaskController);
  });

  describe('create', () => {
    it('should pass the dto to the service and return its result', async () => {
      taskService.create.mockResolvedValue(taskResponse);

      await expect(controller.create({ title: 'Viết báo cáo' })).resolves.toBe(taskResponse);
      expect(taskService.create).toHaveBeenCalledWith({ title: 'Viết báo cáo' });
    });
  });

  describe('findAll', () => {
    it('should pass the query to the service and return its page', async () => {
      const page = { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
      taskService.findAll.mockResolvedValue(page);

      await expect(controller.findAll({ page: 1, limit: 20 })).resolves.toBe(page);
      expect(taskService.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });
  });

  describe('findOne', () => {
    it('should pass the id to the service and return the task', async () => {
      taskService.findOne.mockResolvedValue(taskResponse);

      await expect(controller.findOne(TASK_ID)).resolves.toBe(taskResponse);
      expect(taskService.findOne).toHaveBeenCalledWith(TASK_ID);
    });
  });

  describe('update', () => {
    it('should pass the id and dto to the service and return the updated task', async () => {
      taskService.update.mockResolvedValue(taskResponse);

      await expect(controller.update(TASK_ID, { status: 'Done' })).resolves.toBe(taskResponse);
      expect(taskService.update).toHaveBeenCalledWith(TASK_ID, { status: 'Done' });
    });
  });

  describe('remove', () => {
    it('should pass the id to the service and return nothing', async () => {
      taskService.remove.mockResolvedValue(undefined);

      await expect(controller.remove(TASK_ID)).resolves.toBeUndefined();
      expect(taskService.remove).toHaveBeenCalledWith(TASK_ID);
    });
  });
});
