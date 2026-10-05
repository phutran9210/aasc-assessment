import type { PaginatedResponse } from '@common/types/index.js';
import { buildPaginationMeta } from '@common/utils/index.js';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { CreateTaskDto, TaskQueryDto, UpdateTaskDto } from '../dto/index.js';
import type { Task } from '../entities/task.entity.js';
import { TASK_MESSAGES } from '../messages/index.js';
import { TaskRepository } from '../repositories/task.repository.js';
import type { TaskListItem, TaskResponse } from '../types/index.js';

/** Business logic of tasks. Controllers never touch the repository or the entity directly. */
@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(private readonly taskRepository: TaskRepository) {}

  async create(dto: CreateTaskDto): Promise<TaskResponse> {
    const task = await this.taskRepository.create({
      title: dto.title,
      description: this.normalizeDescription(dto.description),
      status: dto.status,
    });

    this.logger.log(`${TASK_MESSAGES.SUCCESS.CREATED} (id=${task.id})`);
    return this.toResponse(task);
  }

  async findAll(query: TaskQueryDto): Promise<PaginatedResponse<TaskListItem>> {
    const { page, limit, status } = query;
    const { tasks, total } = await this.taskRepository.findPage({ page, limit, status });

    return {
      data: tasks.map((task) => this.toListItem(task)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findOne(id: string): Promise<TaskResponse> {
    return this.toResponse(await this.findOrFail(id));
  }

  async update(id: string, dto: UpdateTaskDto): Promise<TaskResponse> {
    const task = await this.findOrFail(id);

    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined)
      task.description = this.normalizeDescription(dto.description);
    if (dto.status !== undefined) task.status = dto.status;

    const saved = await this.taskRepository.save(task);
    this.logger.log(`${TASK_MESSAGES.SUCCESS.UPDATED} (id=${id})`);
    return this.toResponse(saved);
  }

  async remove(id: string): Promise<void> {
    const task = await this.findOrFail(id);

    await this.taskRepository.remove(task);
    this.logger.log(`${TASK_MESSAGES.SUCCESS.DELETED} (id=${id})`);
  }

  // ── Private Helpers ──

  private async findOrFail(id: string): Promise<Task> {
    const task = await this.taskRepository.findById(id);
    if (!task) throw new NotFoundException(TASK_MESSAGES.ERROR.NOT_FOUND);
    return task;
  }

  /** Missing, `null` and empty descriptions are all stored as NULL. */
  private normalizeDescription(description: string | null | undefined): string | null {
    return description ? description : null;
  }

  private toResponse(task: Task): TaskResponse {
    return { ...this.toListItem(task), updatedAt: task.updatedAt };
  }

  private toListItem(task: Task): TaskListItem {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      createdAt: task.createdAt,
    };
  }
}
