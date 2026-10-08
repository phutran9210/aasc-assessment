import { Test } from '@nestjs/testing';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';
import { AuthService } from '@modules/auth/services/auth.service.js';

import { BitrixInstallController } from '../controllers/bitrix-install.controller.js';
import { BitrixOAuthService } from '../services/bitrix-oauth.service.js';

describe('BitrixInstallController', () => {
  const oauth = {
    handleInstallEvent: jest.fn(),
    install: jest.fn(),
    createAuthorizationUrl: jest.fn(),
    completeAuthorization: jest.fn(),
  };
  let controller: BitrixInstallController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [BitrixInstallController],
      providers: [
        { provide: BitrixOAuthService, useValue: oauth },
        { provide: JwtAuthGuard, useValue: { canActivate: jest.fn(() => true) } },
        { provide: AuthService, useValue: { verifyToken: jest.fn() } },
      ],
    }).compile();
    controller = moduleRef.get(BitrixInstallController);
  });

  it('delegates the install payload to the OAuth service', async () => {
    const body = { event: 'ONAPPINSTALL', auth: {} };
    oauth.install.mockResolvedValue(undefined);
    await expect(controller.install(body)).resolves.toEqual({ status: 'ok' });
    expect(oauth.install).toHaveBeenCalledWith(body);
  });

  it('forwards a form-encoded install event unchanged', async () => {
    const body = {
      event: 'ONAPPINSTALL',
      ts: '1',
      'data[VERSION]': '1',
      'data[ACTIVE]': 'Y',
      'data[INSTALLED]': 'Y',
      'data[LANGUAGE_ID]': 'en',
      'auth[domain]': 'portal.bitrix24.com',
      'auth[scope]': 'crm',
      'auth[access_token]': 'access',
      'auth[refresh_token]': 'refresh',
      'auth[expires_in]': '3600',
      'auth[server_endpoint]': 'https://oauth.bitrix.info/rest/',
      'auth[status]': 'L',
      'auth[client_endpoint]': 'https://portal.bitrix24.com/rest/',
      'auth[member_id]': 'm',
      'auth[application_token]': 'app',
    };
    oauth.install.mockResolvedValue(undefined);
    await controller.install(body);
    expect(oauth.install).toHaveBeenCalledWith(body);
  });

  it('delegates OAuth callback validation to the service', async () => {
    await controller.callback(undefined, undefined);
    expect(oauth.completeAuthorization).toHaveBeenCalledWith(undefined, undefined);
  });

  it('should redirect to Bitrix24 when authorize is requested with JWT', async () => {
    oauth.createAuthorizationUrl.mockResolvedValue(
      'https://portal.bitrix24.com/oauth/authorize/?state=s',
    );
    const response = { redirect: jest.fn() };

    await controller.authorize(response as never);

    expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining('oauth/authorize'));
  });

  it('should expose the JWT guard on the authorization route', () => {
    const guards = Reflect.getMetadata('__guards__', BitrixInstallController.prototype.authorize);
    expect(guards).toContain(JwtAuthGuard);
  });
});
