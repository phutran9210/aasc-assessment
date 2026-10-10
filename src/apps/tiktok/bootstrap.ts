import helmet from 'helmet';
import express from 'express';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { DynamicModule, Type } from '@nestjs/common';

import { LoggingInterceptor } from '@common/interceptors/index.js';
import { TiktokAppModule } from './app.module.js';
import { IntegrationExceptionFilter } from './integration-exception.filter.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';

export async function createTiktokApp(
  rootModule: Type<unknown> | DynamicModule = TiktokAppModule,
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
  app.use(
    express.urlencoded({
      extended: true,
      limit: '256kb',
      verify: (request, _response, buffer) => {
        (request as typeof request & { rawBody?: Buffer }).rawBody = buffer;
      },
    }),
  );
  app.use(helmet());
  // One error shape for every failure, and one log line per request with the path only.
  app.useGlobalFilters(new IntegrationExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  const config = validateTiktokEnv(process.env);
  const origins = config.corsOrigins === '*' ? '*' : config.corsOrigins;
  app.enableCors({
    origin: origins,
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key'],
    exposedHeaders: ['ETag'],
  });
  return app;
}
