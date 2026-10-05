import { BaseEntity } from '@core/database/entities/base.entity.js';
import { TABLE_NAMES } from '@core/database/table-names.js';

import { Column, Entity, Index } from 'typeorm';

import { TASK_CONSTRAINTS, TASK_STATUSES } from '../constants/index.js';
import type { TaskStatus } from '../constants/index.js';

/** Model of the MVC triad: the `task` table. `id` (UUID v7) and timestamps come from BaseEntity. */
@Entity(TABLE_NAMES.TASK)
// Serves the list query: optional filter on status, newest first.
@Index('idx_task_status_created_at', ['status', 'createdAt'])
@Index('idx_task_created_at', ['createdAt'])
export class Task extends BaseEntity {
  @Column({ type: 'varchar', length: TASK_CONSTRAINTS.TITLE.MAX_LENGTH })
  title: string;

  @Column({ type: 'varchar', length: TASK_CONSTRAINTS.DESCRIPTION.MAX_LENGTH, nullable: true })
  description: string | null;

  @Column({
    type: 'varchar',
    length: TASK_CONSTRAINTS.STATUS.MAX_LENGTH,
    default: TASK_STATUSES.TODO,
  })
  status: TaskStatus;
}
