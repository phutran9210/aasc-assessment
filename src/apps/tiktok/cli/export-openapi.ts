import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { TiktokApiModule } from '../api.module.js';
import { createTiktokApp } from '../bootstrap.js';
import { buildOpenApiDocument } from '../openapi.js';

/**
 * Writes the OpenAPI document of the running code to artifacts/tiktok/openapi.json (or to
 * `TIKTOK_OPENAPI_OUTPUT`). The application is started exactly as the API is, without listening
 * on a port, so the file always reflects the real controllers and DTOs.
 */
async function main(): Promise<void> {
  const output = resolve(process.env.TIKTOK_OPENAPI_OUTPUT ?? 'artifacts/tiktok/openapi.json');
  const app = await createTiktokApp(TiktokApiModule.fromEnvironment());
  try {
    await app.init();
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`, 'utf8');
    console.log(`OpenAPI document written to ${output}`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `OpenAPI export failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = 1;
});
