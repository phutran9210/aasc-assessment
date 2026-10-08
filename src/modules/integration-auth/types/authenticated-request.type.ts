import type { Request } from 'express';

import type { Actor } from './actor.type.js';

export type AuthenticatedRequest = Request & { user: Actor };
