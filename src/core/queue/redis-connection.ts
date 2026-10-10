import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

type RedisClientRole = 'producer' | 'worker' | 'shared';

export class RedisConnectionFactory implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisConnectionFactory.name);
  private readonly clients = new Set<Redis>();
  private sharedClient?: Redis;
  private sharedConnecting?: Promise<void>;

  constructor(
    private readonly url: string,
    readonly prefix: string,
  ) {}

  producer(): Redis {
    return this.create('producer', this.producerOptions());
  }

  worker(): Redis {
    return this.create('worker', {
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
    this.sharedClient ??= this.create('shared', this.producerOptions());
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
    const clientCount = this.clients.size;
    if (clientCount > 0) this.logger.debug(`Closing ${clientCount} Redis client(s)...`);

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
    if (clientCount > 0) this.logger.log('Redis clients closed');
  }

  onApplicationShutdown(): Promise<void> {
    return this.closeAll();
  }

  private producerOptions(): RedisOptions {
    return {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => (attempt > 3 ? null : 100),
    };
  }

  private create(role: RedisClientRole, options: RedisOptions): Redis {
    const client = new Redis(this.url, options);
    client.on('connect', () => this.logger.debug(`Redis ${role} connecting...`));
    client.on('ready', () => this.logger.log(`Redis ${role} ready`));
    client.on('error', () => this.logger.error(`Redis ${role} error`));
    client.on('reconnecting', () => this.logger.warn(`Redis ${role} reconnecting...`));
    client.on('close', () => this.logger.warn(`Redis ${role} connection closed`));
    this.clients.add(client);
    return client;
  }
}
