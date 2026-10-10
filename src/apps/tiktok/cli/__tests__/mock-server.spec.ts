import { portFromEnvironment, startMockServer } from '../mock-server.js';

describe('mock server CLI', () => {
  it('uses the default port and validates explicit port bounds', () => {
    expect(portFromEnvironment(undefined)).toBe(3002);
    expect(portFromEnvironment('1')).toBe(1);
    expect(portFromEnvironment('65535')).toBe(65535);
    for (const value of ['0', '65536', '1.5', 'bad']) {
      expect(() => portFromEnvironment(value)).toThrow(RangeError);
    }
  });

  it('starts with environment settings and closes only once across signal handlers', async () => {
    const server = {
      listen: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      bitrixEndpoint: 'http://127.0.0.1:3002/bitrix',
    };
    const createServer = jest.fn(() => server as never);
    const listeners = new Map<string, () => void>();
    const registerSignal = jest.fn((signal: NodeJS.Signals, listener: () => void) => {
      listeners.set(signal, listener);
    });
    const log = jest.fn();

    const lifecycle = await startMockServer(
      { TIKTOK_MOCK_PORT: '4567', TIKTOK_MOCK_HOST: '0.0.0.0', NODE_ENV: 'production' },
      createServer,
      registerSignal,
      log,
    );

    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ exposeControl: false, tiktokApiKey: 'local-only-mock-key' }),
    );
    expect(server.listen).toHaveBeenCalledWith(4567, '0.0.0.0');
    expect(registerSignal).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(server.bitrixEndpoint));
    await lifecycle.close();
    listeners.get('SIGINT')?.();
    listeners.get('SIGTERM')?.();
    await Promise.resolve();
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it('uses configured keys in development and propagates startup failures', async () => {
    const server = {
      listen: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      bitrixEndpoint: 'endpoint',
    };
    const createServer = jest.fn(() => server as never);
    await startMockServer(
      { TIKTOK_MOCK_API_KEY: 'secret', TIKTOK_MOCK_PORT: '3002' },
      createServer,
      () => undefined,
      () => undefined,
    );
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({ exposeControl: true, tiktokApiKey: 'secret' }),
    );

    server.listen.mockRejectedValueOnce(new Error('port in use'));
    await expect(
      startMockServer(
        { TIKTOK_MOCK_PORT: '3002' },
        () => server as never,
        () => undefined,
        () => undefined,
      ),
    ).rejects.toThrow('port in use');
  });
});
