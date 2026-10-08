import {
  normalizeInstallPayload,
  validateBitrixInstallEvent,
} from '../utils/normalize-install-payload.js';

const AUTH = {
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
};

describe('Bitrix install payload normalization and validation', () => {
  it('normalizes flat form fields before validating', () => {
    const payload = normalizeInstallPayload({
      event: 'ONAPPINSTALL',
      'data[VERSION]': '1.0.0',
      'auth[domain]': AUTH.domain,
      'auth[expires_in]': '3600',
      'auth[client_endpoint]': AUTH.client_endpoint,
      'auth[server_endpoint]': AUTH.server_endpoint,
    });

    expect(payload).toMatchObject({
      event: 'ONAPPINSTALL',
      data: { VERSION: '1.0.0' },
      auth: {
        domain: AUTH.domain,
        expires_in: 3600,
        client_endpoint: AUTH.client_endpoint,
        server_endpoint: AUTH.server_endpoint,
      },
    });
  });

  it('requires the configured portal domain and matching Bitrix endpoint host', () => {
    const event = normalizeInstallPayload({ event: 'ONAPPINSTALL', auth: AUTH });
    expect(validateBitrixInstallEvent(event, 'portal.bitrix24.com')).toBe(true);
    expect(validateBitrixInstallEvent(event, 'another.bitrix24.com')).toBe(false);
    expect(
      validateBitrixInstallEvent({
        ...event,
        auth: { ...event.auth, client_endpoint: 'https://attacker.example/rest/' },
      }),
    ).toBe(false);
  });
});
