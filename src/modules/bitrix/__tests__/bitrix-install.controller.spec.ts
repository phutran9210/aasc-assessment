import { Test } from '@nestjs/testing';

import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard.js';
import { AuthService } from '@modules/auth/services/auth.service.js';

import { BitrixInstallController } from '../controllers/bitrix-install.controller.js';
import { BitrixOAuthService } from '../services/bitrix-oauth.service.js';

describe('BitrixInstallController', () => {
  const oauth = {
    handleInstallEvent: jest.fn(),
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

  it('should return 400 when install event auth is incomplete', async () => {
    await expect(controller.install({ event: 'ONAPPINSTALL', auth: {} })).rejects.toThrow();
  });

  it('should accept a form-encoded install event', async () => {
    oauth.handleInstallEvent.mockResolvedValue(undefined);

    await controller.install({
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
    });
    expect(oauth.handleInstallEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'ONAPPINSTALL' }),
    );
  });

  it('should accept a form-encoded install event already nested by the body parser', async () => {
    oauth.handleInstallEvent.mockResolvedValue(undefined);

    await controller.install({
      event: 'ONAPPINSTALL',
      ts: '1',
      data: { VERSION: '1', ACTIVE: 'Y', INSTALLED: 'Y', LANGUAGE_ID: 'vn' },
      auth: {
        domain: 'portal.bitrix24.com',
        scope: 'crm',
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: '3600',
        server_endpoint: 'https://oauth.bitrix.info/rest/',
        status: 'L',
        client_endpoint: 'https://portal.bitrix24.com/rest/',
        member_id: 'm',
        application_token: 'app',
      },
    });
    expect(oauth.handleInstallEvent).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ expires_in: 3600 }) }),
    );
  });

  it('should return 400 when OAuth callback has no code', async () => {
    await expect(controller.callback(undefined, undefined)).rejects.toThrow();
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
