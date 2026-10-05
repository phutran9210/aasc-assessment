import { HttpException, Logger } from '@nestjs/common';

import { COMMON_MESSAGES } from '../messages/index.js';

/** Reply sent through the Socket.IO acknowledgement callback of every client request. */
export type WsAck<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * A rule of the game was broken (wrong turn, occupied cell...). Its message is safe to show to
 * the player, unlike unexpected errors which are logged and replaced by a generic message.
 */
export class GameRuleError extends Error {
  override readonly name = 'GameRuleError';
}

const logger = new Logger('WsAck');

/**
 * Runs a gateway handler and always resolves to an ack, so the client's callback is called
 * exactly once whether the handler succeeds, breaks a rule, or crashes.
 */
export async function toAck<T>(handler: () => T | Promise<T>): Promise<WsAck<T>> {
  try {
    return { ok: true, data: await handler() };
  } catch (error) {
    if (error instanceof GameRuleError) return { ok: false, message: error.message };
    if (error instanceof HttpException && error.getStatus() < 500) {
      return { ok: false, message: error.message };
    }

    logger.error(
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error.stack : undefined,
    );
    return { ok: false, message: COMMON_MESSAGES.ERROR.INTERNAL };
  }
}
