import { timingSafeEqual } from 'node:crypto';

import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';
import { BitrixApiService, BitrixHttpError } from '@modules/bitrix/index.js';

import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import { LeadPullback } from './lead-pullback.service.js';

const LEAD_UPDATED = 'ONCRMLEADUPDATE';
const HANDLER_PATH = 'lead-sync/bitrix-events';
/** A pull that keeps finding the lock taken gives up; the next event or manual pull catches up. */
const MAX_BUSY_RETRIES = 12;

type LeadEvent = {
  event?: unknown;
  data?: { FIELDS?: { ID?: unknown } };
  auth?: { application_token?: unknown };
};

/**
 * Real-time half of the two-way sync. Bitrix24 calls the handler when a lead changes; the lead
 * IDs of the same few seconds are collected and pulled into the Sheet in one run. The app's own
 * updates come back as events too: they find the Sheet already equal and write nothing.
 */
@Injectable()
export class BitrixLeadEvents implements OnApplicationShutdown {
  private readonly logger = new Logger(BitrixLeadEvents.name);
  private readonly pending = new Set<number>();
  private timer: NodeJS.Timeout | undefined;
  private busyRetries = 0;

  constructor(
    private readonly api: BitrixApiService,
    private readonly pullback: LeadPullback,
    @Inject(leadSyncConfig.KEY) private readonly config: LeadSyncConfig,
  ) {}

  /** Handles one event. Throws 403 when the event does not come from this app's portal. */
  async receive(body: unknown): Promise<void> {
    if (!this.pullback.enabled) return;
    const payload = (body ?? {}) as LeadEvent;
    if (payload.event !== LEAD_UPDATED) return;

    const token = payload.auth?.application_token;
    if (typeof token !== 'string' || !(await this.isTrusted(token))) {
      throw new ForbiddenException(LEAD_SYNC_MESSAGES.ERROR.EVENT_TOKEN_INVALID);
    }

    const id = Number(payload.data?.FIELDS?.ID);
    if (!Number.isInteger(id) || id <= 0) return;
    this.pending.add(id);
    this.schedule(this.config.eventDebounceMs);
  }

  /** Asks Bitrix24 to send lead updates to this app. Needs the app installed (OAuth). */
  async register(): Promise<{ event: string; handler: string }> {
    if (!this.config.publicUrl) {
      throw new LeadSyncConfigError(LEAD_SYNC_MESSAGES.ERROR.PUBLIC_URL_MISSING);
    }
    const handler = new URL(HANDLER_PATH, ensureTrailingSlash(this.config.publicUrl)).toString();
    try {
      await this.api.callRaw('event.bind', { event: LEAD_UPDATED, handler });
    } catch (error) {
      const bound = error instanceof BitrixHttpError && /already bind/i.test(error.message);
      if (!bound) throw error;
    }
    return { event: LEAD_UPDATED, handler };
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Two senders are trusted: an outbound webhook created by hand (its token is in the config)
   * and the installed app (its token was stored at install time). Both may be active at once;
   * a lead reported by both is pulled once, because pending IDs are a set.
   */
  private async isTrusted(token: string): Promise<boolean> {
    const { outgoingToken } = this.config;
    if (outgoingToken && safeEqual(token, outgoingToken)) return true;
    return this.api.verifyApplicationToken(token);
  }

  private schedule(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), delayMs);
    this.timer.unref();
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    const ids = [...this.pending];
    if (!ids.length) return;
    this.pending.clear();

    try {
      await this.pullback.start(ids, 'webhook');
      this.busyRetries = 0;
    } catch (error) {
      if (error instanceof LeadSyncBusyError && this.busyRetries < MAX_BUSY_RETRIES) {
        this.busyRetries += 1;
        for (const id of ids) this.pending.add(id);
        this.schedule(this.config.eventRetryMs);
        return;
      }
      this.busyRetries = 0;
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not pull ${ids.length} lead(s) after a Bitrix24 event: ${reason}`);
    }
  }
}

const ensureTrailingSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
