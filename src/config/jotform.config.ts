import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';

import { validateEnv } from './env.validation.js';

export const jotformConfig = registerAs('jotform', () => {
  const env = validateEnv(process.env);

  return {
    apiKey: env.JOTFORM_API_KEY,
    formId: env.JOTFORM_FORM_ID,
    webhookSecret: env.JOTFORM_WEBHOOK_SECRET,
    apiBaseUrl: env.JOTFORM_API_BASE_URL,
    timeoutMs: 10_000,
  };
});

export type JotformConfig = ConfigType<typeof jotformConfig>;
