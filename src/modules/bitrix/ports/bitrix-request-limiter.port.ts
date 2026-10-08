export const BITRIX_REQUEST_LIMITER = Symbol('BITRIX_REQUEST_LIMITER');

export type BitrixRequestLimiter = {
  acquire(): Promise<void>;
  saturate(): Promise<void>;
};
