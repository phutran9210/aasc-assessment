import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { TiktokWorkerModule } from './worker.module.js';
import { validateTiktokEnv } from '../../config/tiktok-app/env.validation.js';

validateTiktokEnv(process.env);
const app = await NestFactory.createApplicationContext(TiktokWorkerModule);
app.enableShutdownHooks();
new Logger('TikTokWorker').log('TikTok integration worker started');
