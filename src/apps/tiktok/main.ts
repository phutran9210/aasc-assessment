import { Logger } from '@nestjs/common';

import { createTiktokApp } from './bootstrap.js';
import { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';

const config = validateTiktokEnv(process.env);
const app = await createTiktokApp();
await app.listen(config.port);
new Logger('TikTokBootstrap').log(`TikTok integration API listening on port ${config.port}`);
