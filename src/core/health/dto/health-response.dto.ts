import { ApiProperty } from '@nestjs/swagger';

import { HEALTH_API_PROPERTIES } from '../constants/index.js';

/** Swagger schema of `HealthResponse`. */
export class HealthResponseDto {
  @ApiProperty(HEALTH_API_PROPERTIES.status)
  status: string;

  @ApiProperty(HEALTH_API_PROPERTIES.database)
  database: string;

  @ApiProperty(HEALTH_API_PROPERTIES.uptime)
  uptime: number;

  @ApiProperty(HEALTH_API_PROPERTIES.timestamp)
  timestamp: string;
}
