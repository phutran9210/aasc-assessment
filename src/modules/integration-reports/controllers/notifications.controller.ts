import { Controller, Get, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';

import { PaginationQueryDto } from '@common/dto/pagination-query.dto.js';
import {
  IntegrationJwtGuard,
  IntegrationRolesGuard,
  Roles,
} from '@modules/integration-auth/index.js';
import type { AuthenticatedRequest } from '@modules/integration-auth/index.js';
import { NotificationService } from '../services/notification.service.js';

@Controller('api/v1/notifications')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin', 'integration_operator', 'integration_analyst')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /** In-app notifications addressed to the caller or to one of the caller's roles. */
  @Get()
  list(@Query() query: PaginationQueryDto, @Req() request: AuthenticatedRequest) {
    return this.notifications.list(request.user, query.page, query.limit);
  }
}
