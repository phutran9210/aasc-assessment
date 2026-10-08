import { Test } from '@nestjs/testing';

import { BitrixCoreModule, BITRIX_CONFIG } from '../bitrix-core.module.js';
import { BITRIX_INSTALLATION_STORE } from '../ports/bitrix-installation-store.port.js';
import { BITRIX_OAUTH_STATE_STORE } from '../ports/bitrix-oauth-state-store.port.js';
import { BITRIX_REQUEST_LIMITER } from '../ports/bitrix-request-limiter.port.js';
import { BitrixApiService } from '../services/bitrix-api.service.js';

describe('BitrixCoreModule', () => {
  it('registers the transport without importing the SQLite database or app config modules', async () => {
    const moduleDefinition = BitrixCoreModule.register({
      providers: [
        { provide: BITRIX_CONFIG, useValue: { timeoutMs: 1000 } },
        {
          provide: BITRIX_INSTALLATION_STORE,
          useValue: { findCurrent: () => Promise.resolve(null) },
        },
        {
          provide: BITRIX_REQUEST_LIMITER,
          useValue: { acquire: async () => {}, saturate: async () => {} },
        },
        {
          provide: BITRIX_OAUTH_STATE_STORE,
          useValue: {
            issue: () => Promise.resolve('state'),
            consume: () => Promise.resolve(true),
          },
        },
      ],
    });
    const moduleRef = await Test.createTestingModule({ imports: [moduleDefinition] }).compile();

    expect(moduleDefinition.imports).toBeUndefined();
    expect(moduleRef.get(BitrixApiService)).toBeInstanceOf(BitrixApiService);

    await moduleRef.close();
  });
});
