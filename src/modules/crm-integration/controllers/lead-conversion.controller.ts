import {
  Controller,
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

import { Roles } from '@modules/integration-auth/decorators/roles.decorator.js';
import type { AuthenticatedRequest } from '@modules/integration-auth/types/authenticated-request.type.js';
import { IntegrationJwtGuard } from '@modules/integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '@modules/integration-auth/guards/roles.guard.js';
import { ConversionService } from '../services/conversion.service.js';

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
    const receipt = await this.conversions.requestManual(
      leadId,
      request.user.sub,
      idempotencyKey,
      body ?? {},
    );
    response.status(receipt.status === 'completed' ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return receipt;
  }
}
