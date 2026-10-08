import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';

import { Roles } from '@modules/integration-auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '@modules/integration-auth/types/authenticated-request.type.js';
import { IntegrationJwtGuard } from '@modules/integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '@modules/integration-auth/guards/roles.guard.js';
import { ConfigurationReplaceDto } from '../dto/configuration.dto.js';
import { ConfigurationService } from '../services/configuration.service.js';

@Controller('configuration')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin')
export class ConfigurationController {
  constructor(private readonly configurations: ConfigurationService) {}

  @Get(':key')
  async read(@Param('key') key: string, @Res({ passthrough: true }) response: Response) {
    const value = await this.configurations.read(key);
    response.setHeader('ETag', value.etag);
    return value;
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
    const value = await this.configurations.replaceFromIfMatch(
      key,
      body.value,
      ifMatch,
      request.user.sub,
    );
    response.setHeader('ETag', value.etag);
    return value;
  }
}
