import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import helmet from 'helmet';

import type { AppConfig } from './app.config.js';

const logger = new Logger('Bootstrap');

/** Swagger UI path. Fixed by the assessment brief ("endpoint /docs"). */
export const SWAGGER_PATH = 'docs';

/** How long a shutdown may take before the process is killed. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

// ── CORS ────────────────────────────────────────────────────────────

export function setupCors(app: NestExpressApplication, config: AppConfig): void {
  const { corsOrigins } = config;

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Browsers reject credentials combined with a wildcard origin.
    credentials: corsOrigins !== '*',
    maxAge: 600,
  });
}

// ── Security Headers ────────────────────────────────────────────────

export function setupSecurity(app: NestExpressApplication): void {
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI bootstraps itself with inline script and style.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          // The app is also served over plain http on localhost.
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
}

// ── Static client ───────────────────────────────────────────────────

/** Serves the browser client (`public/`) from the web root. Run the app from the project root. */
export function setupStaticAssets(app: NestExpressApplication): void {
  app.useStaticAssets(join(process.cwd(), 'public'));
}

// ── Swagger ─────────────────────────────────────────────────────────

/** Serves Swagger UI at `/docs` and the OpenAPI document at `/docs-json` when enabled. */
export function setupSwagger(app: NestExpressApplication, config: AppConfig): void {
  if (!config.swaggerEnabled) return;

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AASC Assessment API')
    .setDescription(
      'API cho các bài kiểm tra: Tư duy lập trình, API cơ bản, Tích hợp Jotform - Bitrix24',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  logger.log('Swagger UI enabled');
}

// ── Graceful Shutdown ───────────────────────────────────────────────

/**
 * Lets NestJS close the HTTP server and the database on SIGINT/SIGTERM, and kills the process
 * if that takes longer than `SHUTDOWN_TIMEOUT_MS` (e.g. a connection that never ends).
 */
export function setupGracefulShutdown(app: NestExpressApplication): void {
  app.enableShutdownHooks();

  const forceExit = (signal: string): void => {
    setTimeout(() => {
      logger.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms (${signal}), forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGINT', () => forceExit('SIGINT'));
  process.on('SIGTERM', () => forceExit('SIGTERM'));
}
