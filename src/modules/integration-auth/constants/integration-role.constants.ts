export const INTEGRATION_ROLES = [
  'integration_admin',
  'integration_operator',
  'integration_analyst',
] as const;

export type IntegrationRole = (typeof INTEGRATION_ROLES)[number];
