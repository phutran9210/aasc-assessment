import { UuidParamPipe } from '@common/pipes/index.js';
import type { PaginatedResponse } from '@common/types/index.js';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  ApiTaskCreate,
  ApiTaskDelete,
  ApiTaskDetail,
  ApiTaskList,
  ApiTaskUpdate,
} from '../decorators/index.js';
import { CreateTaskDto, TaskQueryDto, UpdateTaskDto } from '../dto/index.js';
import { TaskService } from '../services/task.service.js';
import type { TaskListItem, TaskResponse } from '../types/index.js';

/** HTTP layer only: parses and validates the request, then delegates to TaskService. */
@ApiTags('Tasks')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiTaskCreate()
  create(@Body() dto: CreateTaskDto): Promise<TaskResponse> {
    return this.taskService.create(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiTaskList()
  findAll(@Query() query: TaskQueryDto): Promise<PaginatedResponse<TaskListItem>> {
    return this.taskService.findAll(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiTaskDetail()
  findOne(@Param('id', UuidParamPipe) id: string): Promise<TaskResponse> {
    return this.taskService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiTaskUpdate()
  update(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskResponse> {
    return this.taskService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTaskDelete()
  remove(@Param('id', UuidParamPipe) id: string): Promise<void> {
    return this.taskService.remove(id);
  }
}
