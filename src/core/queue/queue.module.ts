import { Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import type { DataSource } from 'typeorm';

import { REDIS_CONNECTION_FACTORY } from '../../config/tiktok-app/redis.config.js';
import { TiktokRedisModule } from './redis.module.js';
import type { RedisConnectionFactory } from './redis-connection.js';
import { AggregateLeaseRepository } from './repositories/aggregate-lease.repository.js';
import { OperationRepository } from './repositories/operation.repository.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { WebhookEventRepository } from './repositories/webhook-event.repository.js';
import { OutboxDispatcherService } from './services/outbox-dispatcher.service.js';
import { QUEUE_NAMES } from '../../modules/crm-integration/types/integration.types.js';
import type { QueueName } from '../../modules/crm-integration/types/integration.types.js';

export const QUEUE_REGISTRY = Symbol('QUEUE_REGISTRY');

@Injectable()
class QueueRegistryLifecycle implements OnApplicationShutdown {
  constructor(@Inject(QUEUE_REGISTRY) private readonly queues: Map<QueueName, Queue>) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}

@Module({
  imports: [TiktokRedisModule],
  providers: [
    WebhookEventRepository,
    OperationRepository,
    OutboxRepository,
    {
      provide: AggregateLeaseRepository,
      inject: [getDataSourceToken('tiktok')],
      useFactory: (dataSource: DataSource) => new AggregateLeaseRepository(dataSource),
    },
    {
      provide: QUEUE_REGISTRY,
      inject: [REDIS_CONNECTION_FACTORY],
      useFactory: (redisFactory: RedisConnectionFactory): Map<QueueName, Queue> => {
        const connection = redisFactory.producer();
        const queues = new Map<QueueName, Queue>();
        for (const name of Object.values(QUEUE_NAMES)) {
          queues.set(name, new Queue(name, { connection, prefix: redisFactory.prefix }));
        }
        return queues;
      },
    },
    {
      provide: OutboxDispatcherService,
      inject: [getDataSourceToken('tiktok'), QUEUE_REGISTRY],
      useFactory: (dataSource: DataSource, queues: Map<QueueName, Queue>) =>
        new OutboxDispatcherService(dataSource, queues),
    },
    QueueRegistryLifecycle,
  ],
  exports: [
    WebhookEventRepository,
    OperationRepository,
    OutboxRepository,
    AggregateLeaseRepository,
    OutboxDispatcherService,
    QUEUE_REGISTRY,
  ],
})
export class QueueModule {}
