import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { TiktokInboxService } from '../services/tiktok-inbox.service.js';
import type { TiktokAppConfig } from '@config/tiktok-app/env.validation.js';

describe('TiktokInboxService', () => {
  it('rejects a missing raw body before opening a transaction', async () => {
    const dataSource = { transaction: jest.fn() } as unknown as DataSource;
    const service = new TiktokInboxService(
      dataSource,
      {} as never,
      {} as never,
      {} as never,
      { advertiserId: 'advertiser-1' } as unknown as TiktokAppConfig,
    );

    await expect(service.receive({} as never, undefined)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
