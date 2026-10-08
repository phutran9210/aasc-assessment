import { TiktokBitrixInstallController } from '../controllers/bitrix-install.controller.js';
import type { BitrixOAuthService } from '@modules/bitrix/services/bitrix-oauth.service.js';

describe('TiktokBitrixInstallController', () => {
  it('delegates install payload handling to the OAuth service', async () => {
    const payload = { event: 'ONAPPINSTALL' };
    const oauthService = { install: jest.fn().mockResolvedValue(undefined) };
    const controller = new TiktokBitrixInstallController(
      oauthService as unknown as BitrixOAuthService,
    );

    await expect(controller.install(payload)).resolves.toEqual({ status: 'ok' });
    expect(oauthService.install).toHaveBeenCalledWith(payload);
  });
});
