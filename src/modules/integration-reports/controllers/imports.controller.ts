import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor, Type } from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import {
  IntegrationJwtGuard,
  IntegrationRolesGuard,
  Roles,
} from '@modules/integration-auth/index.js';
import type { AuthenticatedRequest } from '@modules/integration-auth/index.js';
import { CostImportOptionsDto, LeadImportOptionsDto } from '../dto/import.dto.js';
import { ArtifactService } from '../services/artifact.service.js';
import { CampaignCostImportService } from '../services/campaign-cost-import.service.js';
import { MAX_IMPORT_BYTES } from '../services/import-job.support.js';
import type { UploadedImport } from '../services/import-job.support.js';
import { LeadImportService } from '../services/lead-import.service.js';

type StoredUpload = { path: string; originalname: string; size: number };

/**
 * Streams the single `file` part straight to the artifact temp directory under a generated name.
 * The 10 MiB limit is enforced while streaming, before anything is parsed; no client supplied
 * path or file name is ever used on disk.
 */
function importUpload(): Type<NestInterceptor> {
  return FileInterceptor('file', {
    storage: diskStorage({
      destination: (_request, _file, done) => {
        const artifacts = new ArtifactService(
          validateTiktokEnv(process.env).artifactDir,
          null as never,
        );
        done(null, artifacts.uploadDirectory());
      },
      filename: (_request, _file, done) => done(null, `${randomUUID()}.upload`),
    }),
    limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 10, parts: 12 },
  });
}

/** Removes the streamed upload when the request fails before a job took ownership of it. */
@Injectable()
class UploadCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ file?: StoredUpload }>();
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (request.file?.path) void rm(request.file.path, { force: true });
        return throwError(() => error);
      }),
    );
  }
}

function toUpload(file: StoredUpload | undefined): UploadedImport {
  if (!file) throw new BadRequestException('A multipart "file" part is required');
  return { path: file.path, originalName: file.originalname, size: file.size };
}

@Controller('api/v1')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin', 'integration_operator')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class ImportsController {
  constructor(
    private readonly leadImports: LeadImportService,
    private readonly costImports: CampaignCostImportService,
  ) {}

  @Post('leads/imports')
  @HttpCode(202)
  @UseInterceptors(importUpload(), UploadCleanupInterceptor)
  importLeads(
    @UploadedFile() file: StoredUpload | undefined,
    @Body() options: LeadImportOptionsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.leadImports.start(toUpload(file), options, request.user);
  }

  @Post('analytics/campaign-costs/imports')
  @HttpCode(202)
  @UseInterceptors(importUpload(), UploadCleanupInterceptor)
  importCampaignCosts(
    @UploadedFile() file: StoredUpload | undefined,
    @Body() _options: CostImportOptionsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.costImports.start(toUpload(file), request.user);
  }
}
