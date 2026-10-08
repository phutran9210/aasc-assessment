import { timingSafeEqual } from 'node:crypto';

import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';
import { BitrixApiService, BitrixHttpError } from '@modules/bitrix/index.js';

import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { LEAD_SYNC_RUN_STATUS } from '../constants/index.js';
import { LeadSyncBusyError, LeadSyncConfigError } from '../errors/index.js';
import { LEAD_SYNC_MESSAGES } from '../messages/index.js';
import { LeadSyncPendingLeadRepository } from '../repositories/lead-sync-pending-lead.repository.js';
import { LeadPullback } from './lead-pullback.service.js';

/** A new lead becomes a new row; a changed one updates the row linked to it. */
const LEAD_EVENTS: readonly string[] = ['ONCRMLEADADD', 'ONCRMLEADUPDATE'];
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
 *
 * Lead IDs wait in a database queue and leave it only after a pull that did not fail, so an
 * event received just before a restart, or during a Bitrix24 outage, is pulled later.
 */
@Injectable()
export class BitrixLeadEvents implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BitrixLeadEvents.name);
  private timer: NodeJS.Timeout | undefined;
  private busyRetries = 0;

  constructor(
    private readonly api: BitrixApiService,
    private readonly pullback: LeadPullback,
    private readonly queue: LeadSyncPendingLeadRepository,
    @Inject(leadSyncConfig.KEY) private readonly config: LeadSyncConfig,
  ) {}

  /** Handles one event. Throws 403 when the event does not come from this app's portal. */
  async receive(body: unknown): Promise<void> {
    if (!this.pullback.enabled) return;
    const payload = (body ?? {}) as LeadEvent;
    if (typeof payload.event !== 'string' || !LEAD_EVENTS.includes(payload.event)) return;

    const token = payload.auth?.application_token;
    if (typeof token !== 'string' || !(await this.isTrusted(token))) {
      throw new ForbiddenException(LEAD_SYNC_MESSAGES.ERROR.EVENT_TOKEN_INVALID);
    }

    const id = Number(payload.data?.FIELDS?.ID);
    if (!Number.isInteger(id) || id <= 0) return;
    await this.queue.add(id);
    this.schedule(this.config.eventDebounceMs);
  }

  /** Leads queued by a previous process are pulled once this one is up. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.pullback.enabled) return;
    if ((await this.queue.leadIds()).length) this.schedule(this.config.eventDebounceMs);
  }

  /** Asks Bitrix24 to send new and changed leads to this app. Needs the app installed (OAuth). */
  async register(): Promise<{ events: string[]; handler: string }> {
    if (!this.config.publicUrl) {
      throw new LeadSyncConfigError(LEAD_SYNC_MESSAGES.ERROR.PUBLIC_URL_MISSING);
    }
    const handler = new URL(HANDLER_PATH, ensureTrailingSlash(this.config.publicUrl)).toString();
    for (const event of LEAD_EVENTS) {
      try {
        await this.api.callRaw('event.bind', { event, handler });
      } catch (error) {
        const bound = error instanceof BitrixHttpError && /already bind/i.test(error.message);
        if (!bound) throw error;
      }
    }
    return { events: [...LEAD_EVENTS], handler };
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
    const ids = await this.queue.leadIds();
    if (!ids.length) return;

    try {
      const { done } = await this.pullback.start(ids, 'webhook');
      this.busyRetries = 0;
      const run = await done;
      // A failed pull keeps its leads queued: the next event or restart tries them again.
      if (run.status !== LEAD_SYNC_RUN_STATUS.FAILED) await this.queue.removeLeads(ids);
    } catch (error) {
      if (error instanceof LeadSyncBusyError && this.busyRetries < MAX_BUSY_RETRIES) {
        this.busyRetries += 1;
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
