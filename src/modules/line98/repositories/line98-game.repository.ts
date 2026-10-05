import { BaseRepository } from '@core/database/repositories/base.repository.js';

import { Injectable } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { LINE98_STATUSES } from '../constants/index.js';
import { Line98Game } from '../entities/line98-game.entity.js';

@Injectable()
export class Line98GameRepository extends BaseRepository<Line98Game> {
  constructor(dataSource: DataSource) {
    super(dataSource, Line98Game);
  }

  /** The game the player is in the middle of, if any. */
  findActiveByUser(userId: string): Promise<Line98Game | null> {
    return this.repo.findOne({
      where: { userId, status: LINE98_STATUSES.PLAYING },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /** Closes every unfinished game of the player (used before starting a new one). */
  async abandonActiveByUser(userId: string): Promise<void> {
    await this.repo.update(
      { userId, status: LINE98_STATUSES.PLAYING },
      { status: LINE98_STATUSES.ABANDONED },
    );
  }
}
