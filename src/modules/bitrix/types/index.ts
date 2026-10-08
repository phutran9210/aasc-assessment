export type { BitrixCallOptions, BitrixResult } from './bitrix-api.types.js';
export type { OAuthTokenResponse } from './bitrix-oauth.types.js';
export type {
  BitrixBatchCommand,
  BitrixBatchError,
  BitrixBatchOutcome,
} from './bitrix-batch.types.js';

export type BitrixTokenSet = {
  memberId: string;
  domain: string;
  scope: string;
  status: string;
  clientEndpoint: string;
  serverEndpoint: string;
  accessToken: string;
  refreshToken: string;
  applicationToken: string | null;
  expiresIn: number;
};

export type BitrixInstallationAuth = BitrixTokenSet;

export type BitrixInstallEvent = {
  event: string;
  data: Record<string, unknown>;
  ts: string;
  auth: {
    domain: string;
    scope: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    server_endpoint: string;
    status: string;
    client_endpoint: string;
    member_id: string;
    application_token: string;
  };
};

export type BitrixRestEnvelope<T> = {
  result?: T;
  error?: string;
  error_description?: string;
};
