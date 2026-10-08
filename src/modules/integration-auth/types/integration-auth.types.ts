import type { validateTiktokEnv } from '@config/tiktok-app/env.validation.js';

export type IntegrationJwtClaims = {
  sub: string;
  sid: string;
  authVersion: number;
  iss: string;
  aud: string | string[];
  exp: number;
};

export type IntegrationAuthConfig = ReturnType<typeof validateTiktokEnv>;

export type SessionRecord = {
  subject: string;
  authVersion: number;
  roleFingerprint: string;
};
