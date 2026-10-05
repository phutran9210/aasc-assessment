import { nowIso } from '@common/utils/index.js';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { DATABASE_STATUSES, HEALTH_STATUSES } from '../constants/index.js';
import { HEALTH_MESSAGES } from '../messages/index.js';
import type { HealthResponse } from '../types/index.js';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  /** Reports liveness; fails with 503 when the database does not answer. */
  async check(): Promise<HealthResponse> {
    await this.assertDatabaseIsUp();

    return {
      status: HEALTH_STATUSES.OK,
      database: DATABASE_STATUSES.UP,
      uptime: process.uptime(),
      timestamp: nowIso(),
    };
  }

  private async assertDatabaseIsUp(): Promise<void> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (cause) {
      // Translated (not swallowed): the global filter logs it and answers 503.
      throw new ServiceUnavailableException(HEALTH_MESSAGES.ERROR.DATABASE_DOWN, { cause });
    }
  }
}
