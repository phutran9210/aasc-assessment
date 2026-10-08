import type { Request } from 'express';

export type RawRequest = Request & { rawBody?: Buffer };
