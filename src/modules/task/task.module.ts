import { TaskController } from '@modules/task/controllers/task.controller.js';
import { TaskRepository } from '@modules/task/repositories/task.repository.js';
import { TaskService } from '@modules/task/services/task.service.js';

import { Module } from '@nestjs/common';

@Module({
  controllers: [TaskController],
  providers: [TaskService, TaskRepository],
  exports: [TaskService],
})
export class TaskModule {}
