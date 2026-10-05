export const HEALTH_STATUSES = {
  OK: 'ok',
} as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[keyof typeof HEALTH_STATUSES];

export const DATABASE_STATUSES = {
  UP: 'up',
} as const;

export type DatabaseStatus = (typeof DATABASE_STATUSES)[keyof typeof DATABASE_STATUSES];
