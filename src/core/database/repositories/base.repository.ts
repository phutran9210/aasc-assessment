import type { DataSource, DeepPartial, EntityTarget, FindOptionsWhere, Repository } from 'typeorm';

import type { BaseEntity } from '../entities/base.entity.js';

/**
 * Parent of every feature repository. Wraps the TypeORM repository of one entity so services
 * depend on a small, mockable class instead of `@InjectRepository()`.
 *
 * @example
 * ```ts
 * @Injectable()
 * export class TaskRepository extends BaseRepository<Task> {
 *   constructor(dataSource: DataSource) {
 *     super(dataSource, Task);
 *   }
 * }
 * ```
 */
export abstract class BaseRepository<T extends BaseEntity> {
  protected constructor(
    private readonly dataSource: DataSource,
    private readonly entity: EntityTarget<T>,
  ) {}

  /** TypeORM repository, for queries that the helpers below do not cover. */
  protected get repo(): Repository<T> {
    return this.dataSource.getRepository(this.entity);
  }

  findById(id: string): Promise<T | null> {
    return this.repo.findOne({ where: { id } as FindOptionsWhere<T> });
  }

  create(data: DeepPartial<T>): Promise<T> {
    return this.repo.save(this.repo.create(data));
  }

  save(entity: T): Promise<T> {
    return this.repo.save(entity);
  }

  async remove(entity: T): Promise<void> {
    await this.repo.remove(entity);
  }
}
