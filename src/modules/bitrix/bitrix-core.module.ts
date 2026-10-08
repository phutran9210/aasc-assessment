import { DynamicModule, Module, Provider, Type } from '@nestjs/common';

import { BitrixApiService } from './services/bitrix-api.service.js';
import { BitrixBatchService } from './services/bitrix-batch.service.js';
import { BitrixHttpTransport } from './services/bitrix-http-transport.service.js';
import { BitrixOAuthService } from './services/bitrix-oauth.service.js';
import { BITRIX_INSTALLATION_STORE } from './ports/bitrix-installation-store.port.js';

export type BitrixCoreModuleOptions = {
  imports?: Array<Type<unknown> | DynamicModule>;
  providers: Provider[];
};

@Module({})
export class BitrixCoreModule {
  static register(options: BitrixCoreModuleOptions): DynamicModule {
    return {
      module: BitrixCoreModule,
      imports: options.imports,
      providers: [
        BitrixHttpTransport,
        BitrixOAuthService,
        BitrixApiService,
        BitrixBatchService,
        ...options.providers,
      ],
      exports: [
        BitrixHttpTransport,
        BitrixOAuthService,
        BitrixApiService,
        BitrixBatchService,
        BITRIX_INSTALLATION_STORE,
      ],
    };
  }
}

export { BITRIX_CONFIG } from './ports/bitrix-config.port.js';
