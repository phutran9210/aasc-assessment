import { appConfig, setupCors, setupSecurity, setupSwagger } from '@config/index.js';
import type { AppConfig } from '@config/index.js';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';

/** Boots the real AppModule with the same setup sequence as `main.ts` (minus `listen`). */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useLogger(false);

  const config = app.get<AppConfig>(appConfig.KEY);
  setupCors(app, config);
  setupSecurity(app);
  setupSwagger(app, config);

  await app.init();
  return app;
}

/** Same app, but listening on a random free port: needed by WebSocket clients. */
export async function createListeningTestApp(): Promise<{
  app: NestExpressApplication;
  url: string;
}> {
  const app = await createTestApp();
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };

  return { app, url: `http://127.0.0.1:${port}` };
}
