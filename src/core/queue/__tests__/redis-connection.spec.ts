import { RedisConnectionFactory } from '../redis-connection.js';

describe('RedisConnectionFactory', () => {
  it('shuts down cleanly when no clients were created', async () => {
    const factory = new RedisConnectionFactory('redis://127.0.0.1:1', 'test');

    await expect(factory.closeAll()).resolves.toBeUndefined();
    await expect(factory.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
