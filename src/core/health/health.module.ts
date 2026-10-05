import { HealthController } from '@core/health/controllers/health.controller.js';
import { HealthService } from '@core/health/services/health.service.js';

import { Module } from '@nestjs/common';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
