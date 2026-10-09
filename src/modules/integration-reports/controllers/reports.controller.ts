import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  IntegrationJwtGuard,
  IntegrationRolesGuard,
  Roles,
} from '@modules/integration-auth/index.js';
import type { AuthenticatedRequest } from '@modules/integration-auth/index.js';
import { CreateExportDto, ExportQueryDto } from '../dto/export.dto.js';
import { ArtifactService } from '../services/artifact.service.js';
import { ExportService } from '../services/export.service.js';
import type { ExportQuery } from '../types/report.types.js';

@Controller('api/v1/reports')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin', 'integration_operator', 'integration_analyst')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class ReportsController {
  constructor(
    private readonly exportService: ExportService,
    private readonly artifacts: ArtifactService,
  ) {}

  @Get('export')
  @Roles('integration_admin', 'integration_analyst')
  async export(
    @Query() query: ExportQueryDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const artifact = await this.exportService.download(toExportQuery(query), request.user);
    response.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Export-Row-Count': String(artifact.rowCount),
      'X-Export-Snapshot-At': artifact.metadata.snapshotAt,
      'X-Export-From': artifact.metadata.from,
      'X-Export-To': artifact.metadata.to,
      'X-Export-Time-Basis': artifact.metadata.timeBasis,
      'X-Export-Provider-Mode': `${artifact.metadata.providerMode.tiktok}/${artifact.metadata.providerMode.bitrix}`,
    });
    return new StreamableFile(artifact.stream, {
      type: artifact.contentType,
      disposition: `attachment; filename="${artifact.filename}"`,
      length: artifact.size,
    });
  }

  @Post('exports')
  @HttpCode(202)
  @Roles('integration_admin', 'integration_analyst')
  schedule(@Body() body: CreateExportDto, @Req() request: AuthenticatedRequest) {
    return this.exportService.schedule(toExportQuery(body), request.user);
  }

  @Get('jobs/:id')
  job(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.exportService.getJob(id, request.user);
  }

  @Get('jobs/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const artifact = await this.artifacts.openAuthorized(id, request.user);
    response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(artifact.stream, {
      type: artifact.contentType,
      disposition: `attachment; filename="${artifact.filename}"`,
      length: artifact.size,
    });
  }
}

function toExportQuery(input: ExportQueryDto): ExportQuery {
  return {
    format: input.format,
    from: input.from,
    to: input.to,
    timezone: input.timezone,
    dateRange: input.date_range,
    campaignId: input.campaign_id,
  };
}
