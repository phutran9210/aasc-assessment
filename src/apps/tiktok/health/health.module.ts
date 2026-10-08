import { Module } from '@nestjs/common';

import { TiktokHealthController } from './health.controller.js';
import { TiktokHealthService } from './health.service.js';

@Module({
  controllers: [TiktokHealthController],
  providers: [TiktokHealthService],
})
export class TiktokHealthModule {}
