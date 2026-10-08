import helmet from 'helmet';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { TiktokAppModule } from './app.module.js';
import { validateTiktokEnv } from '../../config/tiktok-app/env.validation.js';

export async function createTiktokApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(TiktokAppModule, {
    rawBody: true,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '256kb' });
  app.use(helmet());
  const config = validateTiktokEnv(process.env);
  const origins = config.corsOrigins === '*' ? '*' : config.corsOrigins;
  app.enableCors({
    origin: origins,
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key'],
    exposedHeaders: ['ETag'],
  });
  return app;
}
