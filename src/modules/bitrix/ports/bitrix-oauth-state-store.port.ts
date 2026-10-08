export const BITRIX_OAUTH_STATE_STORE = Symbol('BITRIX_OAUTH_STATE_STORE');

export type OAuthStateStore = {
  issue(ttlMs: number): Promise<string>;
  consume(state: string): Promise<boolean>;
};
