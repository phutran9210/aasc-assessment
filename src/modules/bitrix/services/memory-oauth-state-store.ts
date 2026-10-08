import { randomUUID } from 'node:crypto';

import { nowMs } from '@common/utils/index.js';

import { Injectable } from '@nestjs/common';

import type { OAuthStateStore } from '../ports/bitrix-oauth-state-store.port.js';

@Injectable()
export class MemoryOAuthStateStore implements OAuthStateStore {
  private readonly states = new Map<string, number>();

  issue(ttlMs: number): Promise<string> {
    const state = randomUUID();
    this.states.set(state, nowMs() + ttlMs);
    return Promise.resolve(state);
  }

  consume(state: string): Promise<boolean> {
    const expiresAt = this.states.get(state);
    this.states.delete(state);
    return Promise.resolve(expiresAt !== undefined && expiresAt > nowMs());
  }
}
