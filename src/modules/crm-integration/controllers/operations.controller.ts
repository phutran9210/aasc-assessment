import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { IntegrationJwtGuard } from '../../integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '../../integration-auth/guards/roles.guard.js';
import { Roles } from '../../integration-auth/decorators/roles.decorator.js';
import type { Actor } from '../../integration-auth/types/actor.type.js';
import { OperationQueryDto } from '../dto/operation-query.dto.js';
import { OperationResolveDto } from '../dto/operation-resolve.dto.js';
import { IntegrationReadService } from '../services/integration-read.service.js';
import { OperationControlService } from '../services/operation-control.service.js';

type AuthenticatedRequest = Request & { user: Actor };

class OperationRetryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

@Controller('api/v1/operations')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class OperationsController {
  constructor(
    private readonly reads: IntegrationReadService,
    private readonly control: OperationControlService,
  ) {}

  @Get()
  @Roles('integration_admin', 'integration_operator')
  list(@Query() query: OperationQueryDto, @Req() request: AuthenticatedRequest) {
    return this.reads.listOperations(query, request.user);
  }

  @Get(':id')
  @Roles('integration_admin', 'integration_operator')
  get(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reads.getOperation(id, request.user);
  }

  @Post(':id/retry')
  @Roles('integration_admin', 'integration_operator')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: OperationRetryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.control.retry(id, body.reason, request.user);
  }

  @Post(':id/resolve')
  @Roles('integration_admin')
  @HttpCode(HttpStatus.OK)
  resolve(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: OperationResolveDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.control.resolve(id, body, request.user);
  }
}
