import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { User } from '../entities/user.entity.js';

@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(dataSource: DataSource) {
    super(dataSource, User);
  }

  findByUsername(username: string): Promise<User | null> {
    return this.repo.findOne({ where: { username } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }
}
