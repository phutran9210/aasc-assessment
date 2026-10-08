import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AssignmentCursorEntity } from '../entities/assignment-cursor.entity.js';

@Injectable()
export class AssignmentCursorRepository {
  async next(cursorKey: string, assigneeIds: string[], manager: EntityManager): Promise<string> {
    const candidates = [...new Set(assigneeIds)].filter(Boolean);
    if (!candidates.length) throw new Error('ASSIGNEE_UNAVAILABLE');

    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [cursorKey]);
    const repository = manager.getRepository(AssignmentCursorEntity);
    let cursor = await repository.findOne({
      where: { cursorKey },
      lock: { mode: 'pessimistic_write' },
    });
    if (!cursor) {
      cursor = repository.create({ cursorKey, lastAssigneeId: null, position: '0' });
    }
    const previousIndex = cursor.lastAssigneeId ? candidates.indexOf(cursor.lastAssigneeId) : -1;
    const index = (previousIndex + 1) % candidates.length;
    const assignee = candidates[index];
    if (!assignee) throw new Error('ASSIGNEE_UNAVAILABLE');
    cursor.lastAssigneeId = assignee;
    cursor.position = (BigInt(cursor.position) + 1n).toString();
    await repository.save(cursor);
    return assignee;
  }
}
