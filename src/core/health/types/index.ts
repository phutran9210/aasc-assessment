import type { DatabaseStatus, HealthStatus } from '../constants/index.js';

export type HealthResponse = {
  status: HealthStatus;
  database: DatabaseStatus;
  uptime: number;
  timestamp: string;
};
