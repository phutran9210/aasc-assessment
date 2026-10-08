import helmet from 'helmet';
import express from 'express';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Type } from '@nestjs/common';

import { TiktokAppModule } from './app.module.js';
import { validateTiktokEnv } from '../../config/tiktok-app/env.validation.js';

export async function createTiktokApp(
  rootModule: Type<unknown> = TiktokAppModule,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    rawBody: true,
    bodyParser: false,
  });
  app.use(
    express.json({
      limit: '256kb',
      verify: (request, _response, buffer) => {
        (request as typeof request & { rawBody?: Buffer }).rawBody = buffer;
      },
    }),
  );
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
