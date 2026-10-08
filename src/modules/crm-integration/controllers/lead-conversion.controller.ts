import {
  Controller,
  ConflictException,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';

import { Roles } from '../../integration-auth/decorators/roles.decorator.js';
import { IntegrationJwtGuard } from '../../integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '../../integration-auth/guards/roles.guard.js';
import type { Actor } from '../../integration-auth/types/actor.type.js';
import { ConversionService } from '../services/conversion.service.js';

type AuthenticatedRequest = Request & { user: Actor };

@Controller('api/v1/leads')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin', 'integration_operator')
export class LeadConversionController {
  constructor(private readonly conversions: ConversionService) {}

  @Post(':id/convert-to-deal')
  @HttpCode(HttpStatus.ACCEPTED)
  async convert(
    @Param('id', new ParseUUIDPipe({ version: '7' })) leadId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const receipt = await this.conversions.request(
      leadId,
      'manual',
      request.user.sub,
      idempotencyKey,
      body ?? {},
    );
    if (!receipt) throw new ConflictException('Manual conversion did not produce an operation');
    response.status(receipt.status === 'completed' ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return receipt;
  }
}
