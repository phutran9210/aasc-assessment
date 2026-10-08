import { Controller, Get } from '@nestjs/common';

import { TiktokHealthService } from './health.service.js';

@Controller('health')
export class TiktokHealthController {
  constructor(private readonly health: TiktokHealthService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return this.health.live();
  }
}
