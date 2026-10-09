import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { OnApplicationShutdown } from '@nestjs/common';

export class RedisConnectionFactory implements OnApplicationShutdown {
  private readonly clients = new Set<Redis>();
  private sharedClient?: Redis;
  private sharedConnecting?: Promise<void>;

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

  /**
   * One lazily connected client for short commands (cache, limits, heartbeats). Concurrent callers
   * join the same connection attempt, and a failed attempt is retried on the next call.
   */
  async shared(): Promise<Redis> {
    if (this.sharedClient?.status === 'end') this.sharedClient = undefined;
    this.sharedClient ??= this.producer();
    const client = this.sharedClient;
    if (client.status === 'ready') return client;
    if (!this.sharedConnecting) {
      if (client.status !== 'wait') throw new Error('Redis is not connected');
      this.sharedConnecting = client.connect().finally(() => {
        this.sharedConnecting = undefined;
      });
    }
    await this.sharedConnecting;
    return client;
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
    this.sharedClient = undefined;
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
