import { PaginationQueryDto } from '@common/dto/index.js';
import { UuidParamPipe } from '@common/pipes/index.js';
import type { PaginatedResponse } from '@common/types/index.js';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { TriggerRunDto } from '../dto/trigger-run.dto.js';
import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import { LeadSyncStatusService } from '../services/lead-sync-status.service.js';
import { SyncRunner } from '../services/sync-runner.service.js';
import type { LeadSyncStatusResponse, RunDetailResponse, RunResponse } from '../types/index.js';

/** Admin entry points of the Google Sheets → Bitrix24 lead sync. */
@ApiTags('Lead Sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lead-sync')
export class LeadSyncController {
  constructor(
    private readonly runner: SyncRunner,
    private readonly status: LeadSyncStatusService,
  ) {}

  /**
   * Starts a run in the background and answers at once: a large Sheet takes longer than a
   * request should wait. Follow the run with `GET /lead-sync/runs/:id`.
   */
  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Chạy đồng bộ lead ngay (chạy nền)' })
  async trigger(@Body() dto?: TriggerRunDto): Promise<{ runId: string }> {
    try {
      const { run } = await this.runner.start({
        trigger: 'http',
        dryRun: dto?.dryRun,
        force: dto?.force,
      });
      return { runId: run.id };
    } catch (error) {
      if (error instanceof LeadSyncBusyError) throw new ConflictException(error.message);
      if (error instanceof LeadSyncConfigError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  @Get('runs')
  @ApiOperation({ summary: 'Danh sách các lần chạy, mới nhất trước' })
  listRuns(@Query() query: PaginationQueryDto): Promise<PaginatedResponse<RunResponse>> {
    return this.status.listRuns(query.page, query.limit);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Bộ đếm và các hàng đã xử lý của một lần chạy' })
  getRun(@Param('id', UuidParamPipe) id: string): Promise<RunDetailResponse> {
    return this.status.getRun(id);
  }

  @Get('status')
  @ApiOperation({ summary: 'Lịch, lần chạy gần nhất và trạng thái kết nối Google, Bitrix24' })
  getStatus(): Promise<LeadSyncStatusResponse> {
    return this.status.getStatus();
  }
}
