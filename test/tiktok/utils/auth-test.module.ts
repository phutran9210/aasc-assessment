import { Controller, Get, Module, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import type { Actor } from '../../../src/modules/integration-auth/types/actor.type.js';
import { IntegrationAuthModule } from '../../../src/modules/integration-auth/integration-auth.module.js';
import { Roles } from '../../../src/modules/integration-auth/decorators/roles.decorator.js';
import { IntegrationJwtGuard } from '../../../src/modules/integration-auth/guards/integration-jwt.guard.js';
import { IntegrationRolesGuard } from '../../../src/modules/integration-auth/guards/roles.guard.js';
import { TiktokAppModule } from '../../../src/apps/tiktok/app.module.js';
import { BitrixAdapterModule } from '../../../src/modules/crm-integration/bitrix-adapter.module.js';
import type { BitrixConfig } from '../../../src/config/bitrix.config.js';

const bitrixConfig: BitrixConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  portalDomain: 'portal.bitrix24.com',
  requisitePresetId: 1,
  webhookUrl: undefined,
  timeoutMs: 10_000,
  stateTtlSeconds: 600,
  refreshSkewSeconds: 60,
};

type AuthenticatedRequest = Request & { user: Actor };

@Controller('test/auth')
@UseGuards(IntegrationJwtGuard)
class AuthTestController {
  @Get('me')
  me(@Req() request: AuthenticatedRequest): Actor {
    return request.user;
  }

  @Get('admin')
  @UseGuards(IntegrationRolesGuard)
  @Roles('integration_admin')
  admin(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [
    TiktokAppModule,
    IntegrationAuthModule,
    BitrixAdapterModule.register({
      portalKey: 'test-portal',
      namespace: 'auth-e2e',
      bitrix: bitrixConfig,
    }),
  ],
  controllers: [AuthTestController],
})
export class AuthTestModule {}
