import { ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { bitrixConfig } from '@config/index.js';

import { BitrixInstallationRepository } from '../repositories/bitrix-installation.repository.js';
import { BitrixHttpTransport } from '../services/bitrix-http-transport.service.js';
import { BitrixOAuthService } from '../services/bitrix-oauth.service.js';
import type { BitrixInstallEvent } from '../types/index.js';

const AUTH = {
  domain: 'portal.bitrix24.com',
  scope: 'crm',
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  server_endpoint: 'https://oauth.bitrix.info/rest/',
  status: 'L',
  client_endpoint: 'https://portal.bitrix24.com/rest/',
  member_id: 'member-1',
  application_token: 'application-1',
};

const EVENT: BitrixInstallEvent = {
  event: 'ONAPPINSTALL',
  data: { VERSION: '1.0.0', ACTIVE: 'Y', INSTALLED: 'Y', LANGUAGE_ID: 'en' },
  ts: '1700000000',
  auth: AUTH,
};

describe('BitrixOAuthService', () => {
  const transport = {
    getJson: jest.fn(),
    postRest: jest.fn(),
  };
  const repository = {
    findCurrent: jest.fn(),
    saveTokens: jest.fn(),
    acquireRefreshLock: jest.fn(),
    replaceTokens: jest.fn(),
    releaseRefreshLock: jest.fn(),
  };
  let service: BitrixOAuthService;

  beforeEach(async () => {
    jest.resetAllMocks();
    repository.acquireRefreshLock.mockResolvedValue(true);
    repository.replaceTokens.mockResolvedValue(true);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BitrixOAuthService,
        { provide: BitrixHttpTransport, useValue: transport },
        { provide: BitrixInstallationRepository, useValue: repository },
        {
          provide: bitrixConfig.KEY,
          useValue: {
            clientId: 'client-id',
            clientSecret: 'client-secret',
            portalDomain: 'portal.bitrix24.com',
            requisitePresetId: 1,
            timeoutMs: 10_000,
            stateTtlSeconds: 600,
            refreshSkewSeconds: 60,
          },
        },
      ],
    }).compile();
    service = moduleRef.get(BitrixOAuthService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should save a valid ONAPPINSTALL auth object after app.info succeeds', async () => {
    transport.postRest.mockResolvedValue({ result: { CODE: 'client-id' } });
    repository.saveTokens.mockResolvedValue({});

    await service.handleInstallEvent(EVENT);

    expect(transport.postRest).toHaveBeenCalledWith(
      AUTH.client_endpoint,
      'app.info',
      {},
      AUTH.access_token,
    );
    expect(repository.saveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-1' }),
    );
  });

  it('should replace installation tokens on ONAPPUPDATE', async () => {
    transport.postRest.mockResolvedValue({ result: { CODE: 'client-id' } });
    repository.saveTokens.mockResolvedValue({});

    await service.handleInstallEvent({
      ...EVENT,
      event: 'ONAPPUPDATE',
      auth: { ...AUTH, access_token: 'new' },
    });

    expect(repository.saveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'new' }),
    );
  });

  it('should reject an unsupported event without saving tokens', async () => {
    await expect(service.handleInstallEvent({ ...EVENT, event: 'UNKNOWN' })).rejects.toThrow(
      'Sự kiện Bitrix24 không được hỗ trợ',
    );
    expect(repository.saveTokens).not.toHaveBeenCalled();
  });

  it('should reject a different member id without changing the installation', async () => {
    transport.postRest.mockResolvedValue({ result: { CODE: 'client-id' } });
    repository.saveTokens.mockRejectedValue(
      new ConflictException('Bitrix24 installation không khớp'),
    );

    await expect(service.handleInstallEvent(EVENT)).rejects.toThrow(ConflictException);
  });

  it('should reject an invalid app.info response', async () => {
    transport.postRest.mockResolvedValue({ result: { CODE: 'other-client' } });

    await expect(service.handleInstallEvent(EVENT)).rejects.toThrow(
      'Không xác thực được ứng dụng Bitrix24',
    );
    expect(repository.saveTokens).not.toHaveBeenCalled();
  });

  it('should exchange code only when state matches', async () => {
    const url = await service.createAuthorizationUrl();
    const state = new URL(url).searchParams.get('state');
    expect(state).toBeTruthy();
    transport.getJson.mockResolvedValue({ ...AUTH, expires_in: 3600 });
    repository.saveTokens.mockResolvedValue({});

    await service.completeAuthorization('code-1', state as string);

    expect(transport.getJson).toHaveBeenCalledWith(
      expect.stringContaining('grant_type=authorization_code'),
    );
    expect(repository.saveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-1' }),
    );
  });

  it('should reject expired or reused state', async () => {
    await expect(service.completeAuthorization('code-1', 'unknown')).rejects.toThrow(
      'OAuth state không hợp lệ',
    );
  });

  it('should leave stored tokens unchanged when code exchange fails', async () => {
    const url = await service.createAuthorizationUrl();
    const state = new URL(url).searchParams.get('state') as string;
    transport.getJson.mockRejectedValue(new ServiceUnavailableException('OAuth lỗi'));

    await expect(service.completeAuthorization('code-1', state)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(repository.saveTokens).not.toHaveBeenCalled();
  });

  it('should refresh and persist both tokens when access token is near expiry', async () => {
    repository.findCurrent.mockResolvedValue({
      ...AUTH,
      id: 'id-1',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 1_000),
    });
    transport.getJson.mockResolvedValue({
      ...AUTH,
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    });
    await expect(service.getAccessToken()).resolves.toBe('new-access');
    expect(repository.replaceTokens).toHaveBeenCalledWith(
      'id-1',
      'old-refresh',
      expect.objectContaining({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
    );
  });

  it('should keep the portal domain and scope when the token server answers a refresh', async () => {
    repository.findCurrent.mockResolvedValue({
      domain: 'portal.bitrix24.com',
      scope: 'crm',
      refreshToken: 'old-refresh',
      applicationToken: 'application-1',
      accessTokenExpiresAt: new Date(Date.now() + 1_000),
    });
    // The token server reports its own domain and a generic scope, not the portal's.
    transport.getJson.mockResolvedValue({
      ...AUTH,
      domain: 'oauth.bitrix.info',
      scope: 'app',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    });
    await service.getAccessToken();

    expect(repository.replaceTokens).toHaveBeenCalledWith(
      undefined,
      'old-refresh',
      expect.objectContaining({ domain: 'portal.bitrix24.com', scope: 'crm' }),
    );
  });

  it('should leave stored tokens unchanged when refresh fails', async () => {
    repository.findCurrent.mockResolvedValue({
      ...AUTH,
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    transport.getJson.mockRejectedValue(new ServiceUnavailableException('OAuth lỗi'));

    await expect(service.getAccessToken()).rejects.toThrow(ServiceUnavailableException);
    expect(repository.replaceTokens).not.toHaveBeenCalled();
    expect(repository.releaseRefreshLock).toHaveBeenCalledTimes(1);
  });

  it('should share one refresh request for concurrent callers', async () => {
    repository.findCurrent.mockResolvedValue({
      ...AUTH,
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    let resolveRefresh: ((value: unknown) => void) | undefined;
    transport.getJson.mockReturnValue(new Promise((resolve) => (resolveRefresh = resolve)));

    const first = service.getAccessToken();
    const second = service.getAccessToken();
    resolveRefresh?.({ ...AUTH, access_token: 'new-access', refresh_token: 'new-refresh' });

    await expect(Promise.all([first, second])).resolves.toEqual(['new-access', 'new-access']);
    expect(transport.getJson).toHaveBeenCalledTimes(1);
  });

  describe('refresh races', () => {
    const stored = (overrides: Record<string, unknown> = {}) => ({
      id: 'id-1',
      scope: 'crm',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      applicationToken: 'application-1',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    });
    const refreshed = { ...AUTH, access_token: 'new-access', refresh_token: 'new-refresh' };

    it('should reuse the stored token when the rejected one was already replaced', async () => {
      repository.findCurrent.mockResolvedValue(stored({ accessToken: 'newer-access' }));

      await expect(service.refreshAccessToken('old-access')).resolves.toBe('newer-access');
      expect(transport.getJson).not.toHaveBeenCalled();
      expect(repository.acquireRefreshLock).not.toHaveBeenCalled();
    });

    it('should refresh when the rejected token is still the stored one', async () => {
      repository.findCurrent.mockResolvedValue(stored());
      transport.getJson.mockResolvedValue(refreshed);

      await expect(service.refreshAccessToken('old-access')).resolves.toBe('new-access');
      expect(repository.acquireRefreshLock).toHaveBeenCalledWith(
        'id-1',
        'old-refresh',
        expect.any(Number),
      );
    });

    it('should wait for another process holding the lock instead of refreshing twice', async () => {
      repository.acquireRefreshLock.mockResolvedValue(false);
      repository.findCurrent
        .mockResolvedValueOnce(stored())
        .mockResolvedValue(stored({ accessToken: 'other-access', refreshToken: 'other-refresh' }));

      await expect(service.refreshAccessToken('old-access')).resolves.toBe('other-access');
      expect(transport.getJson).not.toHaveBeenCalled();
    });

    it('should take over when the other process releases the lock without refreshing', async () => {
      repository.acquireRefreshLock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      repository.findCurrent.mockResolvedValue(stored());
      transport.getJson.mockResolvedValue(refreshed);

      await expect(service.refreshAccessToken('old-access')).resolves.toBe('new-access');
      expect(transport.getJson).toHaveBeenCalledTimes(1);
    });

    it('should keep tokens written by a reinstall that finished during the refresh', async () => {
      repository.findCurrent
        .mockResolvedValueOnce(stored())
        .mockResolvedValue(stored({ accessToken: 'reinstall-access' }));
      transport.getJson.mockResolvedValue(refreshed);
      repository.replaceTokens.mockResolvedValue(false);

      await expect(service.refreshAccessToken('old-access')).resolves.toBe('reinstall-access');
    });
  });
});
