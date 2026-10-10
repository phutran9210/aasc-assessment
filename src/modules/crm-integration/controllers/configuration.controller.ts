import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Put,
  Req,
  Res,
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
import { ConfigurationReplaceDto } from '../dto/configuration.dto.js';
import { ConfigurationService } from '../services/configuration.service.js';

@Controller('api/v1/config')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin')
export class ConfigurationController {
  constructor(private readonly configurations: ConfigurationService) {}

  @Get('mappings')
  readMappings(@Res({ passthrough: true }) response: Response) {
    return this.read('mapping', response);
  }

  @Put('mappings')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  replaceMappings(
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: ConfigurationReplaceDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.replace('mapping', ifMatch, body, request, response);
  }

  @Get('rules')
  readRules(@Res({ passthrough: true }) response: Response) {
    return this.read('rules', response);
  }

  @Put('rules')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  replaceRules(
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: ConfigurationReplaceDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.replace('rules', ifMatch, body, request, response);
  }

  private async read(key: string, response: Response) {
    const value = await this.configurations.read(key);
    response.setHeader('ETag', value.etag);
    return value;
  }

  private async replace(
    key: string,
    ifMatch: string | undefined,
    body: ConfigurationReplaceDto,
    request: AuthenticatedRequest,
    response: Response,
  ) {
    const value = await this.configurations.replaceFromIfMatch(
      key,
      configurationDocument(body),
      ifMatch,
      request.user.sub,
    );
    response.setHeader('ETag', value.etag);
    return value;
  }
}

function configurationDocument(body: ConfigurationReplaceDto): Record<string, unknown> {
  if (body.value) return body.value;
  if (body.field_mapping === undefined && body.deal_rules === undefined) {
    throw new BadRequestException('value, field_mapping or deal_rules is required');
  }
  return {
    ...(body.field_mapping === undefined ? {} : { field_mapping: body.field_mapping }),
    ...(body.deal_rules === undefined ? {} : { deal_rules: body.deal_rules }),
  };
}
