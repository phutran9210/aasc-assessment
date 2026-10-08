import { SetMetadata } from '@nestjs/common';

import type { IntegrationRole } from '../types/actor.type.js';

export const INTEGRATION_ROLES_KEY = 'integration:roles';

export const Roles = (...roles: IntegrationRole[]) => SetMetadata(INTEGRATION_ROLES_KEY, roles);
