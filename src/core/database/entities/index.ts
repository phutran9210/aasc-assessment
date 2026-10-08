import { BitrixInstallation } from '@modules/bitrix/entities/bitrix-installation.entity.js';
import { CaroMatch } from '@modules/caro/entities/caro-match.entity.js';
import { JotformSubmission } from '@modules/jotform/entities/jotform-submission.entity.js';
import { LeadSyncRunItem } from '@modules/lead-sync/entities/lead-sync-run-item.entity.js';
import { LeadSyncPendingLead } from '@modules/lead-sync/entities/lead-sync-pending-lead.entity.js';
import { LeadSyncRun } from '@modules/lead-sync/entities/lead-sync-run.entity.js';
import { Line98Game } from '@modules/line98/entities/line98-game.entity.js';
import { Task } from '@modules/task/entities/task.entity.js';
import { User } from '@modules/user/entities/user.entity.js';

import { BaseEntity } from './base.entity.js';

export { BaseEntity };

type EntityClass = new () => BaseEntity;

/**
 * Every TypeORM entity of the app. Feature modules do not call `TypeOrmModule.forFeature()`;
 * they append their entity classes here so the single DataSource knows about them.
 *
 * To keep this import acyclic, entity and repository files must import `base.entity.js`,
 * `base.repository.js` and `table-names.js` directly — never the `@core/database/index.js` barrel.
 */
export const ENTITIES: EntityClass[] = [
  BitrixInstallation,
  CaroMatch,
  JotformSubmission,
  LeadSyncPendingLead,
  LeadSyncRun,
  LeadSyncRunItem,
  Line98Game,
  Task,
  User,
];
