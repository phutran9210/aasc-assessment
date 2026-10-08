import {
  appConfig,
  setupCors,
  setupGracefulShutdown,
  setupSecurity,
  setupStaticAssets,
  setupSwagger,
  SWAGGER_PATH,
} from '@config/index.js';
import type { AppConfig } from '@config/index.js';
import { SyncScheduler } from '@modules/lead-sync/index.js';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfig>(appConfig.KEY);
  const logger = new Logger('Bootstrap');

  // No global prefix or versioning: the assessment briefs fix the routes (/install, /contacts,
  // /docs). Global pipe/filter/interceptor are registered in AppModule so e2e tests share them.
  setupCors(app, config);
  setupSecurity(app);
  setupSwagger(app, config);
  setupStaticAssets(app);
  setupGracefulShutdown(app);

  await app.listen(config.port);

  // Started here and not in a lifecycle hook: the CLI boots the same AppModule and must not
  // run the schedule a second time.
  app.get(SyncScheduler).start();

  const baseUrl = `http://localhost:${config.port}`;
  logger.log(`Server is running on ${baseUrl}`);
  logger.log(`Environment: ${config.nodeEnv}`);
  logger.log(`Health check: ${baseUrl}/health`);
  if (config.swaggerEnabled) logger.log(`Swagger Docs: ${baseUrl}/${SWAGGER_PATH}`);
  logger.log(`Game client: ${baseUrl}/`);
}

await bootstrap();
