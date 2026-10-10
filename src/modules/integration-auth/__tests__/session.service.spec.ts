import { SessionService } from '../services/session.service.js';

function setup() {
  const redis = {
    status: 'ready',
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue(1),
  };
  const service = new SessionService(redis as never, 'integration-test', 2, 60);
  return { redis, service };
}

describe('SessionService', () => {
  it('stores session identity and validates the same subject, version, and roles', async () => {
    const { redis, service } = setup();
    await service.create('sid-1', 'user-1', 2, 900, ['integration_operator', 'integration_admin']);
    const stored = redis.set.mock.calls[0]?.[1] as string;
    redis.get.mockResolvedValue(stored);

    await expect(
      service.isActive('sid-1', 'user-1', 2, ['integration_admin', 'integration_operator']),
    ).resolves.toBe(true);
    await expect(
      service.isActive('sid-1', 'different', 2, ['integration_operator', 'integration_admin']),
    ).resolves.toBe(false);
    await expect(
      service.isActive('sid-1', 'user-1', 3, ['integration_operator', 'integration_admin']),
    ).resolves.toBe(false);
    await expect(service.isActive('sid-1', 'user-1', 2, ['integration_operator'])).resolves.toBe(
      false,
    );
    expect(redis.set.mock.calls[0]?.[0]).toBe('integration-test:auth:session:sid-1');
  });

  it('treats missing and malformed session data as inactive', async () => {
    const { redis, service } = setup();
    await expect(service.isActive('sid-1', 'user-1', 1, [])).resolves.toBe(false);
    redis.get.mockResolvedValueOnce('{bad-json');
    await expect(service.isActive('sid-1', 'user-1', 1, [])).resolves.toBe(false);
  });

  it('rejects a duplicate Redis session ID without reporting it as created', async () => {
    const { redis, service } = setup();
    redis.set.mockResolvedValueOnce(null);
    await expect(service.create('sid-1', 'user-1', 1, 900, [])).rejects.toMatchObject({
      status: 503,
    });
  });

  it('limits login attempts across both IP and username keys', async () => {
    const { redis, service } = setup();
    redis.eval.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    await expect(service.assertLoginAllowed('127.0.0.1', 'Operator')).resolves.toBeUndefined();
    await expect(service.assertLoginAllowed('127.0.0.1', 'Operator')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('resets login attempts and revokes a session', async () => {
    const { redis, service } = setup();
    await service.resetLoginAttempts('127.0.0.1', 'Operator');
    await service.revoke('sid-1');
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('integration-test:auth:session:sid-1');
  });

  it('reports Redis failures as service unavailable', async () => {
    const { redis, service } = setup();
    redis.get.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.isActive('sid-1', 'user-1', 1, [])).rejects.toMatchObject({ status: 503 });
    redis.eval.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.resetLoginAttempts('127.0.0.1', 'Operator')).rejects.toMatchObject({
      status: 503,
    });
  });
});
