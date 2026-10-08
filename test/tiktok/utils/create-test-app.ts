import type { INestApplication } from '@nestjs/common';
import type { Type } from '@nestjs/common';

import { createTiktokApp } from '../../../src/apps/tiktok/bootstrap.js';

export type TestApp = {
  app: INestApplication;
  close(): Promise<void>;
};

export async function createTestApp(
  envOverrides: Record<string, string>,
  rootModule?: Type<unknown>,
): Promise<TestApp> {
  const previousValues = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envOverrides)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    const app = await createTiktokApp(rootModule);
    await app.init();
    return {
      app,
      async close() {
        await app.close();
        restoreEnvironment(previousValues);
      },
    };
  } catch (error) {
    restoreEnvironment(previousValues);
    throw error;
  }
}

function restoreEnvironment(previousValues: Map<string, string | undefined>): void {
  for (const [key, value] of previousValues) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
