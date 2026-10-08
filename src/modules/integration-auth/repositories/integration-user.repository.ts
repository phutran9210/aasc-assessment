import type { DataSource } from 'typeorm';

import { IntegrationUserEntity } from '../entities/integration-user.entity.js';

export class IntegrationUserRepository {
  private readonly repository;

  constructor(dataSource: DataSource) {
    this.repository = dataSource.getRepository(IntegrationUserEntity);
  }

  async findByUsername(username: string): Promise<IntegrationUserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.username) = :username', { username: username.toLowerCase() })
      .getOne();
  }

  findById(id: string): Promise<IntegrationUserEntity | null> {
    return this.repository.findOne({ where: { id } });
  }
}
