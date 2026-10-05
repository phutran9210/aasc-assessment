import { toSkip } from '@common/utils/index.js';
import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import type { TaskStatus } from '../constants/index.js';
import { Task } from '../entities/task.entity.js';

export type TaskListFilter = {
  page: number;
  limit: number;
  status?: TaskStatus;
};

@Injectable()
export class TaskRepository extends BaseRepository<Task> {
  constructor(dataSource: DataSource) {
    super(dataSource, Task);
  }

  /** One page of tasks, newest first, plus the total matching the filter. */
  async findPage(filter: TaskListFilter): Promise<{ tasks: Task[]; total: number }> {
    const [tasks, total] = await this.repo.findAndCount({
      where: filter.status ? { status: filter.status } : {},
      // `id` is a time-sortable UUID v7: it breaks ties between rows created in the same second.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: toSkip(filter.page, filter.limit),
      take: filter.limit,
    });

    return { tasks, total };
  }
}
