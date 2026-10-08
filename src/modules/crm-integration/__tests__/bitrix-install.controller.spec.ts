import { BadRequestException } from '@nestjs/common';

import { TiktokBitrixInstallController } from '../controllers/bitrix-install.controller.js';
import type { BitrixOAuthService } from '../../bitrix/services/bitrix-oauth.service.js';
import type { BitrixConfig } from '../../../config/bitrix.config.js';

const VALID_INSTALL_EVENT = {
  event: 'ONAPPINSTALL',
  auth: {
    domain: 'portal.bitrix24.com',
    scope: 'crm',
    access_token: 'access-secret',
    refresh_token: 'refresh-secret',
    expires_in: 3600,
    server_endpoint: 'https://oauth.bitrix.info/rest/',
    status: 'L',
    client_endpoint: 'https://portal.bitrix24.com/rest/',
    member_id: 'member-1',
    application_token: 'application-secret',
  },
};

const CONFIG: BitrixConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  portalDomain: 'portal.bitrix24.com',
  requisitePresetId: 1,
  webhookUrl: undefined,
  timeoutMs: 10_000,
  stateTtlSeconds: 600,
  refreshSkewSeconds: 60,
};

describe('TiktokBitrixInstallController', () => {
  it('rejects a callback endpoint outside the configured portal before app.info', async () => {
    const oauthService = { handleInstallEvent: jest.fn() };
    const controller = new TiktokBitrixInstallController(
      oauthService as unknown as BitrixOAuthService,
      CONFIG,
    );

    await expect(
      controller.install({
        ...VALID_INSTALL_EVENT,
        auth: {
          ...VALID_INSTALL_EVENT.auth,
          client_endpoint: 'https://attacker.example/rest/',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(oauthService.handleInstallEvent).not.toHaveBeenCalled();
  });

  it('normalizes and accepts an install event for the configured portal', async () => {
    const oauthService = { handleInstallEvent: jest.fn().mockResolvedValue(undefined) };
    const controller = new TiktokBitrixInstallController(
      oauthService as unknown as BitrixOAuthService,
      CONFIG,
    );

    await expect(controller.install(VALID_INSTALL_EVENT)).resolves.toEqual({ status: 'ok' });
    expect(oauthService.handleInstallEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ONAPPINSTALL' }),
    );
  });
});
