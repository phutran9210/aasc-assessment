import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import type { VerifiedEvent } from '../domain/webhook-envelope.js';

export type VerifiedWebhookRequest = RawBodyRequest<Request> & {
  verifiedTiktokEvent: VerifiedEvent;
};

export type GuardedWebhookRequest = RawBodyRequest<Request> & {
  verifiedTiktokEvent?: VerifiedEvent;
};
