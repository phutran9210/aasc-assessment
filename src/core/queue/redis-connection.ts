import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { OnApplicationShutdown } from '@nestjs/common';

export class RedisConnectionFactory implements OnApplicationShutdown {
  private readonly clients = new Set<Redis>();

  constructor(
    private readonly url: string,
    readonly prefix: string,
  ) {}

  producer(): Redis {
    return this.create({
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => (attempt > 3 ? null : 100),
    });
  }

  worker(): Redis {
    return this.create({
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: () => 1_000,
    });
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.clients].map(async (client) => {
        if (client.status === 'ready') {
          try {
            await client.quit();
          } catch {
            client.disconnect();
          }
        } else {
          client.disconnect();
        }
      }),
    );
    this.clients.clear();
  }

  onApplicationShutdown(): Promise<void> {
    return this.closeAll();
  }

  private create(options: RedisOptions): Redis {
    const client = new Redis(this.url, options);
    this.clients.add(client);
    return client;
  }
}
