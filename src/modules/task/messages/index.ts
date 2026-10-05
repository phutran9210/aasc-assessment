import { createModuleMessages } from '@common/messages/index.js';

import { TASK_CONSTRAINTS, TASK_STATUS_VALUES } from '../constants/index.js';

export const TASK_MESSAGES = createModuleMessages({
  entityName: 'Task',
  entityNamePlural: 'Task',
  customError: {
    TITLE_REQUIRED: 'title không được để trống',
    TITLE_NOT_STRING: 'title phải là chuỗi',
    TITLE_TOO_LONG: `title không được vượt quá ${TASK_CONSTRAINTS.TITLE.MAX_LENGTH} ký tự`,
    DESCRIPTION_NOT_STRING: 'description phải là chuỗi',
    DESCRIPTION_TOO_LONG: `description không được vượt quá ${TASK_CONSTRAINTS.DESCRIPTION.MAX_LENGTH} ký tự`,
    STATUS_INVALID: `status phải là một trong: ${TASK_STATUS_VALUES.join(', ')}`,
  },
});
