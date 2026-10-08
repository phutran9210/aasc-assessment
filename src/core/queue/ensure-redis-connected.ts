import type { Redis } from 'ioredis';

const connections = new WeakMap<Redis, Promise<void>>();

/** Starts or joins one lazy Redis connection attempt for a shared client. */
export function ensureRedisConnected(redis: Redis): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  const pending = connections.get(redis);
  if (pending) return pending;

  const connecting = connect(redis).finally(() => connections.delete(redis));
  connections.set(redis, connecting);
  return connecting;
}

function connect(redis: Redis): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') return redis.connect();

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      redis.off('ready', onReady);
      redis.off('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    redis.once('ready', onReady);
    redis.once('error', onError);
  });
}
