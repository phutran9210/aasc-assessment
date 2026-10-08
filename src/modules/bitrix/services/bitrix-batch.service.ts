import { Injectable } from '@nestjs/common';

import { BITRIX_BATCH } from '../constants/index.js';
import { BITRIX_MESSAGES } from '../messages/index.js';
import { encodeBatchCommand } from '../utils/batch-command.encoder.js';
import type {
  BitrixBatchCommand,
  BitrixBatchError,
  BitrixBatchOutcome,
  BatchPayload,
} from '../types/bitrix-batch.types.js';
export type {
  BitrixBatchCommand,
  BitrixBatchError,
  BitrixBatchOutcome,
} from '../types/bitrix-batch.types.js';
import { BitrixApiService } from './bitrix-api.service.js';
import type { BitrixCallOptions } from '../types/bitrix-api.types.js';

/**
 * Runs up to 50 REST methods in one `batch` call. `halt: 0` lets every command run even when
 * another one fails, so the outcome is reported per command key: a result or an error.
 */
@Injectable()
export class BitrixBatchService {
  constructor(private readonly api: BitrixApiService) {}

  async execute(
    commands: BitrixBatchCommand[],
    options: BitrixCallOptions = {},
  ): Promise<BitrixBatchOutcome> {
    const outcome: BitrixBatchOutcome = { results: new Map(), errors: new Map() };
    if (!commands.length) return outcome;
    if (commands.length > BITRIX_BATCH.MAX_COMMANDS) {
      throw new RangeError(
        `A Bitrix24 batch holds at most ${BITRIX_BATCH.MAX_COMMANDS} commands, got ${commands.length}`,
      );
    }

    const cmd: Record<string, string> = {};
    for (const command of commands) {
      if (command.key in cmd) throw new Error(`Duplicate batch command key: ${command.key}`);
      cmd[command.key] = encodeBatchCommand(command.method, command.params);
    }

    const { result } = await this.api.callRaw<BatchPayload>(
      'batch',
      { halt: 0, cmd },
      { timeoutMs: BITRIX_BATCH.TIMEOUT_MS, ...options },
    );
    const results = toRecord(result.result);
    const errors = toRecord(result.result_error);

    for (const { key } of commands) {
      if (key in errors) outcome.errors.set(key, toBatchError(errors[key]));
      else if (key in results) outcome.results.set(key, results[key]);
      else {
        outcome.errors.set(key, {
          code: 'NO_RESULT',
          message: BITRIX_MESSAGES.ERROR.BATCH_NO_RESULT,
        });
      }
    }
    return outcome;
  }
}

/** PHP serialises an empty map as `[]`, so an array here means "nothing". */
function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toBatchError(value: unknown): BitrixBatchError {
  if (typeof value === 'string') return { code: 'UNKNOWN', message: value };
  const { error, error_description: description } = toRecord(value);
  const code = typeof error === 'string' && error ? error : 'UNKNOWN';
  return { code, message: typeof description === 'string' && description ? description : code };
}
