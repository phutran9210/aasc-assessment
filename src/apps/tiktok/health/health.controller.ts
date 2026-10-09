import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { TiktokHealthService } from './health.service.js';
import type { ReadinessDto } from './health.service.js';

@Controller('health')
export class TiktokHealthController {
  constructor(private readonly health: TiktokHealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return this.health.live();
  }

  @Get('ready')
  ready(): Promise<ReadinessDto> {
    return this.readiness();
  }

  /** Alias of `/health/ready` for probes that only know one health URL. */
  @Get()
  overall(): Promise<ReadinessDto> {
    return this.readiness();
  }

  private async readiness(): Promise<ReadinessDto> {
    const readiness = await this.health.ready();
    if (readiness.status !== 'ok') throw new ServiceUnavailableException(readiness);
    return readiness;
  }
}
