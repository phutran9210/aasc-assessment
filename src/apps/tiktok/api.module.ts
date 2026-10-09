import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { CrmIntegrationModule } from '@modules/crm-integration/crm-integration.module.js';
import { TiktokAppModule } from './app.module.js';
import { environmentBitrixAdapter } from './bitrix-adapter.config.js';

/**
 * Composition root of the deployed API: the base application plus the CRM module bound to the
 * Bitrix24 adapter of this environment. It is built on demand because the adapter reads the
 * environment, which tests and command line tools set before they start the application.
 */
@Module({})
export class TiktokApiModule {
  static fromEnvironment(): DynamicModule {
    return {
      module: TiktokApiModule,
      imports: [
        TiktokAppModule,
        CrmIntegrationModule.register({ imports: [environmentBitrixAdapter()] }),
      ],
    };
  }
}
