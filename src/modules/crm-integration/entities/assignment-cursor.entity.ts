import { Column, Entity, Index } from 'typeorm';

import { IntegrationBaseEntity } from '../../../apps/tiktok/database/base.entity.js';
import { TIKTOK_TABLE_NAMES } from '../../../apps/tiktok/database/table-names.js';

@Entity({ name: TIKTOK_TABLE_NAMES.assignmentCursor })
@Index('uq_integration_assignment_cursor_key', ['cursorKey'], { unique: true })
export class AssignmentCursorEntity extends IntegrationBaseEntity {
  @Column({ name: 'cursor_key', type: 'varchar', length: 255 })
  cursorKey!: string;

  @Column({ name: 'last_assignee_id', type: 'varchar', length: 255, nullable: true })
  lastAssigneeId!: string | null;

  @Column({ type: 'bigint', default: 0 })
  position!: string;
}
