import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';

import { Roles } from '../../integration-auth/decorators/roles.decorator.js';
import { IntegrationJwtGuard } from '../../integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '../../integration-auth/guards/roles.guard.js';
import type { Actor } from '../../integration-auth/types/actor.type.js';
import { ConfigurationReplaceDto } from '../dto/configuration.dto.js';
import { ConfigurationService } from '../services/configuration.service.js';

type AuthenticatedRequest = Request & { user: Actor };

@Controller('configuration')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin')
export class ConfigurationController {
  constructor(private readonly configurations: ConfigurationService) {}

  @Get(':key')
  async read(@Param('key') key: string, @Res({ passthrough: true }) response: Response) {
    try {
      const value = await this.configurations.read(key);
      response.setHeader('ETag', value.etag);
      return value;
    } catch (error) {
      if (error instanceof NotFoundException) {
        response.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          message: error.message,
        });
        return undefined;
      }
      throw error;
    }
  }

  @Put(':key')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async replace(
    @Param('key') key: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: ConfigurationReplaceDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const expectedRevision = parseIfMatch(ifMatch);
    const value = await this.configurations.replace(
      key,
      body.value,
      expectedRevision,
      request.user.sub,
    );
    response.setHeader('ETag', value.etag);
    return value;
  }
}

function parseIfMatch(value: string | undefined): number {
  if (!value) throw new HttpException('If-Match is required', HttpStatus.PRECONDITION_REQUIRED);
  const match = /^"(0|[1-9]\d*)"$/.exec(value.trim());
  if (!match) throw new HttpException('If-Match is invalid', HttpStatus.BAD_REQUEST);
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision))
    throw new HttpException('If-Match is invalid', HttpStatus.BAD_REQUEST);
  return revision;
}
