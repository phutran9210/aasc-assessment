import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

import type { CaroEndReason, CaroResult } from '../constants/index.js';
import type { CaroMove } from '../types/index.js';

/** A finished Caro match (the history). `createdAt` is the moment the match ended. */
@Entity(TABLE_NAMES.CARO_MATCH)
@Index('idx_caro_match_player_x', ['playerXId', 'createdAt'])
@Index('idx_caro_match_player_o', ['playerOId', 'createdAt'])
export class CaroMatch extends BaseEntity {
  @Column({ type: 'varchar', length: 36 })
  playerXId: string;

  @Column({ type: 'varchar', length: 36 })
  playerOId: string;

  /** Display names at the time of the match, so the history stays readable after a rename. */
  @Column({ type: 'varchar', length: 30 })
  playerXName: string;

  @Column({ type: 'varchar', length: 30 })
  playerOName: string;

  /** null for a draw. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  winnerId: string | null;

  @Column({ type: 'varchar', length: 10 })
  result: CaroResult;

  @Column({ type: 'varchar', length: 20 })
  reason: CaroEndReason;

  /** Every move in order: enough to replay the match. */
  @Column({ type: 'simple-json' })
  moves: CaroMove[];

  @Column({ type: 'int' })
  moveCount: number;

  @Column({ type: 'datetime' })
  startedAt: Date;
}
