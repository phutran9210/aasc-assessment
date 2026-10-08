import type { IntegrationRole } from '../constants/integration-role.constants.js';

export type { IntegrationRole } from '../constants/integration-role.constants.js';

/** Current database-backed identity attached to a protected TikTok request. */
export type Actor = {
  sub: string;
  sid: string;
  username: string;
  roles: IntegrationRole[];
};
