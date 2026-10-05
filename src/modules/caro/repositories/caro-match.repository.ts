import { toSkip } from '@common/utils/index.js';
import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { CaroMatch } from '../entities/caro-match.entity.js';

@Injectable()
export class CaroMatchRepository extends BaseRepository<CaroMatch> {
  constructor(dataSource: DataSource) {
    super(dataSource, CaroMatch);
  }

  /** Matches the user played as X or O, newest first. */
  async findPageByPlayer(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ matches: CaroMatch[]; total: number }> {
    const [matches, total] = await this.repo.findAndCount({
      where: [{ playerXId: userId }, { playerOId: userId }],
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: toSkip(page, limit),
      take: limit,
    });
    return { matches, total };
  }
}
