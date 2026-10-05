import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

import { LINE98_STATUSES } from '../constants/index.js';
import type { Line98Status } from '../constants/index.js';
import type { Board } from '../types/index.js';

/** One Line 98 game of one player. The whole board is saved after every move. */
@Entity(TABLE_NAMES.LINE98_GAME)
// Serves "the game this player is currently playing".
@Index('idx_line98_game_user_status', ['userId', 'status'])
export class Line98Game extends BaseEntity {
  @Column({ type: 'varchar', length: 36 })
  userId: string;

  /** 9x9 matrix: 0 = empty, 1..5 = ball colour. */
  @Column({ type: 'simple-json' })
  board: Board;

  @Column({ type: 'simple-json' })
  nextColors: number[];

  @Column({ type: 'int', default: 0 })
  score: number;

  @Column({ type: 'int', default: 0 })
  moveCount: number;

  @Column({ type: 'varchar', length: 20, default: LINE98_STATUSES.PLAYING })
  status: Line98Status;
}
