export type RedisConfig = {
  url: string;
  queuePrefix: string;
};

export const REDIS_CONNECTION_FACTORY = Symbol('REDIS_CONNECTION_FACTORY');
