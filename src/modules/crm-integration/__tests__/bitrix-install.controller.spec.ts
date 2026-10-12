import { TiktokBitrixInstallController } from '../controllers/bitrix-install.controller.js';
import type { BitrixDealEventRegistrar } from '../services/bitrix-deal-event-registrar.service.js';
import type { BitrixOAuthService } from '@modules/bitrix/index.js';

function setup() {
  const oauthService = {
    install: jest.fn().mockResolvedValue(undefined),
    completeAuthorization: jest.fn().mockResolvedValue(undefined),
  };
  const dealEvents = { register: jest.fn().mockResolvedValue({ status: 'registered' }) };
  const controller = new TiktokBitrixInstallController(
    oauthService as unknown as BitrixOAuthService,
    dealEvents as unknown as BitrixDealEventRegistrar,
  );
  return { controller, oauthService, dealEvents };
}

describe('TiktokBitrixInstallController', () => {
  it('delegates install payload handling to the OAuth service', async () => {
    const payload = { event: 'ONAPPINSTALL' };
    const { controller, oauthService } = setup();

    await expect(controller.install(payload)).resolves.toEqual({ status: 'ok' });
    expect(oauthService.install).toHaveBeenCalledWith(payload);
  });

  it('registers the deal events after an install event and after the authorization callback', async () => {
    const { controller, dealEvents } = setup();

    await controller.install({ event: 'ONAPPINSTALL' });
    await controller.callback('code', 'state');

    expect(dealEvents.register).toHaveBeenCalledTimes(2);
  });

  it('does not register deal events when the installation is refused', async () => {
    const { controller, oauthService, dealEvents } = setup();
    oauthService.install.mockRejectedValue(new Error('refused'));

    await expect(controller.install({})).rejects.toThrow('refused');
    expect(dealEvents.register).not.toHaveBeenCalled();
  });
});
