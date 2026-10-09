import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';
import { assertDeploymentIdentity } from './deployment-identity.js';
import { TiktokWorkerModule } from './worker.module.js';

const config = validateTiktokEnv(process.env);
const app = await NestFactory.createApplicationContext(TiktokWorkerModule);
await assertDeploymentIdentity(app.get<DataSource>(getDataSourceToken('tiktok')), config);
app.enableShutdownHooks();
new Logger('TikTokWorker').log('TikTok integration worker started');
