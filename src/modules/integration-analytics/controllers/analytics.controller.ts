import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';

import {
  IntegrationJwtGuard,
  IntegrationRolesGuard,
  Roles,
} from '@modules/integration-auth/index.js';
import {
  CampaignPerformanceQueryDto,
  ConversionRatesQueryDto,
} from '../dto/analytics-query.dto.js';
import { AnalyticsService } from '../services/analytics.service.js';

@Controller('api/v1/analytics')
@UseGuards(IntegrationJwtGuard, IntegrationRolesGuard)
@Roles('integration_admin', 'integration_operator', 'integration_analyst')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('conversion-rates')
  conversionRates(@Query() query: ConversionRatesQueryDto) {
    return this.analytics.conversionRates({
      from: query.from,
      to: query.to,
      timezone: query.timezone,
      dateRange: query.date_range,
      campaignId: query.campaign_id,
    });
  }

  @Get('campaign-performance')
  campaignPerformance(@Query() query: CampaignPerformanceQueryDto) {
    return this.analytics.campaignPerformance({
      from: query.from,
      to: query.to,
      timezone: query.timezone,
      dateRange: query.date_range,
      campaignId: query.campaign_id,
      currency: query.currency,
      page: query.page,
      limit: query.limit,
    });
  }
}
