import { Logger } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { TiktokApiModule } from './api.module.js';
import { createTiktokApp } from './bootstrap.js';
import { assertDeploymentIdentity } from './deployment-identity.js';
import { mountOpenApi } from './openapi.js';

const config = validateTiktokEnv(process.env);
const app = await createTiktokApp(TiktokApiModule.fromEnvironment());
// Refuse to serve a database that belongs to another advertiser, portal or provider mode.
await assertDeploymentIdentity(app.get<DataSource>(getDataSourceToken('tiktok')), config);
if (config.swaggerEnabled) mountOpenApi(app);
app.enableShutdownHooks();
await app.listen(config.port, '0.0.0.0');
new Logger('TikTokBootstrap').log(`TikTok integration API listening on port ${config.port}`);
