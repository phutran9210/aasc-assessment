export type UUID = string;
export type ExternalId = string;
export type IsoInstant = string;
export type DecimalString = string;

export type TiktokMode = 'mock' | 'business-api';
export type BitrixMode = 'mock' | 'real';

export type Scope = {
  advertiserId: string;
  portalKey: string;
  tiktokMode: TiktokMode;
  bitrixMode: BitrixMode;
};
