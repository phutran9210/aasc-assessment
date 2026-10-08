import { Controller, Get, UseGuards, UsePipes, ValidationPipe, Req, Query } from '@nestjs/common';

import { IntegrationJwtGuard } from '@modules/integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '@modules/integration-auth/guards/roles.guard.js';
import { Roles } from '@modules/integration-auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '@modules/integration-auth/types/authenticated-request.type.js';
import { DealQueryDto } from '../dto/deal-query.dto.js';
import { IntegrationReadService } from '../services/integration-read.service.js';

@Controller('api/v1/deals')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin', 'integration_operator', 'integration_analyst')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class DealsController {
  constructor(private readonly reads: IntegrationReadService) {}

  @Get()
  list(@Query() query: DealQueryDto, @Req() request: AuthenticatedRequest) {
    return this.reads.listDeals(query, request.user);
  }
}
