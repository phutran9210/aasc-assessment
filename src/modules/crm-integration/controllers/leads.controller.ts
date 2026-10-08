import { Controller, Get, UseGuards, UsePipes, ValidationPipe, Req, Query } from '@nestjs/common';

import {
  IntegrationJwtGuard,
  IntegrationRolesGuard,
  Roles,
} from '@modules/integration-auth/index.js';
import type { AuthenticatedRequest } from '@modules/integration-auth/index.js';
import { LeadQueryDto } from '../dto/lead-query.dto.js';
import { IntegrationReadService } from '../services/integration-read.service.js';

@Controller('api/v1/leads')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin', 'integration_operator', 'integration_analyst')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class LeadsController {
  constructor(private readonly reads: IntegrationReadService) {}

  @Get()
  list(@Query() query: LeadQueryDto, @Req() request: AuthenticatedRequest) {
    return this.reads.listLeads(query, request.user);
  }
}
