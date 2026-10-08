import { Module } from '@nestjs/common';

import { TiktokConfigModule } from '../../config/tiktok-app/config.module.js';
import { TiktokHealthModule } from './health/health.module.js';

@Module({
  imports: [TiktokConfigModule, TiktokHealthModule],
})
export class TiktokAppModule {}
