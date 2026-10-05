import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiHealthCheck } from '../decorators/index.js';
import { HealthService } from '../services/health.service.js';
import type { HealthResponse } from '../types/index.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiHealthCheck()
  check(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}
