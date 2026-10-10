import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BitrixInstallEventDto } from '../bitrix-install-event.dto.js';

const valid = {
  event: 'ONAPPINSTALL',
  data: {},
  ts: '1710000000',
  auth: {
    domain: 'portal.bitrix24.com',
    scope: 'crm',
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    server_endpoint: 'https://oauth.example/',
    status: 'L',
    client_endpoint: 'https://portal.example/',
    member_id: 'member',
    application_token: 'secret',
  },
};

describe('BitrixInstallEventDto', () => {
  it('accepts a valid install event and validates the nested auth object', async () => {
    const instance = plainToInstance(BitrixInstallEventDto, valid);
    expect(instance.auth).toBeDefined();
    expect(await validate(instance)).toHaveLength(0);
  });

  it('rejects an unknown event and invalid required fields', async () => {
    const invalid = plainToInstance(BitrixInstallEventDto, {
      ...valid,
      event: 'UNKNOWN',
      data: null,
      auth: { ...valid.auth, expires_in: 'later', application_token: 4 },
    });
    const errors = await validate(invalid);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['event', 'data', 'auth']),
    );
    expect(errors.find((error) => error.property === 'auth')?.children?.length).toBeGreaterThan(0);
  });
});
