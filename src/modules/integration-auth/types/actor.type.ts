export const INTEGRATION_ROLES = [
  'integration_admin',
  'integration_operator',
  'integration_analyst',
] as const;

export type IntegrationRole = (typeof INTEGRATION_ROLES)[number];

/** Current database-backed identity attached to a protected TikTok request. */
export type Actor = {
  sub: string;
  sid: string;
  username: string;
  roles: IntegrationRole[];
};

export const INTEGRATION_ROLE_PERMISSIONS: Record<IntegrationRole, readonly string[]> = {
  integration_admin: ['*'],
  integration_operator: [
    'leads:read',
    'deals:read',
    'deals:convert',
    'operations:retry',
    'leads:import',
    'reports:import',
    'alerts:read',
  ],
  integration_analyst: ['leads:read', 'deals:read', 'analytics:read', 'reports:export'],
};
