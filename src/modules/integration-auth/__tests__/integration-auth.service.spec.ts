import { IntegrationAuthService } from '../services/integration-auth.service.js';

describe('IntegrationAuthService logout authorization header', () => {
  it('passes only the bearer token to the logout use case', async () => {
    const service = new IntegrationAuthService({} as never, {} as never, {} as never, {} as never);
    const logout = jest.spyOn(service, 'logout').mockResolvedValue();

    await service.logoutAuthorizationHeader('Bearer token-value');

    expect(logout).toHaveBeenCalledWith('token-value');
  });

  it('rejects non-bearer schemes by passing no token to the logout use case', async () => {
    const service = new IntegrationAuthService({} as never, {} as never, {} as never, {} as never);
    const logout = jest.spyOn(service, 'logout').mockResolvedValue();

    await service.logoutAuthorizationHeader('Basic credentials');

    expect(logout).toHaveBeenCalledWith(undefined);
  });
});
