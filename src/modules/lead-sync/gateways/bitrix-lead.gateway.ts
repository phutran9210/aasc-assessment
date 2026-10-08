import { leadSyncConfig } from '@config/index.js';
import type { LeadSyncConfig } from '@config/index.js';
import {
  BITRIX_BATCH,
  BitrixApiService,
  BitrixBatchService,
  BitrixHttpError,
} from '@modules/bitrix/index.js';
import type { BitrixBatchCommand, BitrixCallOptions } from '@modules/bitrix/index.js';

import { Inject, Injectable } from '@nestjs/common';

import { BITRIX_TRANSIENT_CODES, LEAD_ENTITY_TYPE_ID } from '../constants/index.js';
import { chunk } from '../domain/chunk.js';
import type {
  BitrixLeadItem,
  DuplicateQuery,
  LeadWriteOp,
  LeadWriteResult,
} from '../types/index.js';
import { buildCreateFields, buildUpdateFields } from './lead-payload.js';

const ORIGINAL_UF_NAMES = 'Y';

/**
 * The only place that knows which Bitrix24 methods a lead needs and what their payloads look
 * like. Switching to the deprecated `crm.lead.*` family would change this file and
 * `lead-payload.ts` only.
 */
@Injectable()
export class BitrixLeadGateway {
  /** Reads change nothing, so temporary failures are simply retried. */
  private readonly readOptions: BitrixCallOptions;

  constructor(
    private readonly api: BitrixApiService,
    private readonly batch: BitrixBatchService,
    @Inject(leadSyncConfig.KEY) config: LeadSyncConfig,
  ) {
    this.readOptions = { retryTransient: true, maxRetries: config.maxRetries };
  }

  /** Names of every lead field of the portal, custom fields under their `UF_CRM_*` name. */
  async getFieldNames(): Promise<Set<string>> {
    const { result } = await this.api.callRaw<{ fields?: Record<string, unknown> }>(
      'crm.item.fields',
      { entityTypeId: LEAD_ENTITY_TYPE_ID, useOriginalUfNames: ORIGINAL_UF_NAMES },
      this.readOptions,
    );
    return new Set(Object.keys(result.fields ?? {}));
  }

  /**
   * Looks up leads by email or phone. One command carries one value: with several values in one
   * command the answer would not say which ID matched which value. Returns lead IDs per query
   * key, ascending. Any failed command fails the search, because treating it as "no duplicate"
   * would create one.
   */
  async findDuplicates(queries: DuplicateQuery[]): Promise<Map<string, number[]>> {
    const found = new Map<string, number[]>();
    for (const group of chunk(queries, BITRIX_BATCH.MAX_COMMANDS)) {
      const outcome = await this.batch.execute(
        group.map((query) => ({
          key: query.key,
          method: 'crm.duplicate.findbycomm',
          params: { entity_type: 'LEAD', type: query.type, values: [query.value] },
        })),
        this.readOptions,
      );

      const [failure] = outcome.errors.values();
      if (failure) {
        const status = BITRIX_TRANSIENT_CODES.includes(failure.code) ? 503 : 400;
        throw new BitrixHttpError(failure.message, failure.code, status);
      }
      for (const query of group) {
        found.set(query.key, toLeadIds(outcome.results.get(query.key)));
      }
    }
    return found;
  }

  /** Current leads by ID, with their multifields (needed to replace a phone or an email). */
  async getLeads(ids: number[]): Promise<Map<number, BitrixLeadItem>> {
    const leads = new Map<number, BitrixLeadItem>();
    // crm.item.list serves 50 items per page: 50 ids per call always fit one page.
    for (const group of chunk(ids, BITRIX_BATCH.MAX_COMMANDS)) {
      const { result } = await this.api.callRaw<{ items?: BitrixLeadItem[] }>(
        'crm.item.list',
        {
          entityTypeId: LEAD_ENTITY_TYPE_ID,
          filter: { '@id': group },
          select: ['*'],
          useOriginalUfNames: ORIGINAL_UF_NAMES,
        },
        this.readOptions,
      );
      for (const item of result.items ?? []) leads.set(Number(item.id), item);
    }
    return leads;
  }

  /**
   * Creates and updates leads in one batch and reports the outcome per row number. A failed
   * command only fails its own row. A failure of the batch call itself is thrown as is and is
   * never retried here: after a timeout Bitrix24 may already have created the leads, so the
   * caller has to search for duplicates again before sending anything.
   */
  async write(ops: LeadWriteOp[]): Promise<Map<number, LeadWriteResult>> {
    const results = new Map<number, LeadWriteResult>();
    for (const group of chunk(ops, BITRIX_BATCH.MAX_COMMANDS)) {
      const commands = group.map(toCommand);
      const outcome = await this.batch.execute(commands);

      group.forEach((op, index) => {
        const { key } = commands[index];
        const error = outcome.errors.get(key);
        if (error) {
          results.set(op.row.rowNumber, { ok: false, code: error.code, message: error.message });
          return;
        }
        const leadId = op.action === 'update' ? op.leadId : toItemId(outcome.results.get(key));
        results.set(
          op.row.rowNumber,
          leadId !== undefined && Number.isInteger(leadId) && leadId > 0
            ? { ok: true, leadId }
            : { ok: false, code: 'ID_MISSING', message: 'Bitrix24 không trả về ID của lead' },
        );
      });
    }
    return results;
  }
}

function toCommand(op: LeadWriteOp): BitrixBatchCommand {
  const { rowNumber } = op.row;
  if (op.action === 'update') {
    return {
      key: `u${rowNumber}`,
      method: 'crm.item.update',
      params: {
        entityTypeId: LEAD_ENTITY_TYPE_ID,
        id: op.leadId,
        fields: buildUpdateFields(op.row, op.current),
        useOriginalUfNames: ORIGINAL_UF_NAMES,
      },
    };
  }
  return {
    key: `c${rowNumber}`,
    method: 'crm.item.add',
    params: {
      entityTypeId: LEAD_ENTITY_TYPE_ID,
      fields: buildCreateFields(op.row),
      useOriginalUfNames: ORIGINAL_UF_NAMES,
    },
  };
}

/** `{ LEAD: [345, 512] }`, or `[]` when nothing matched. */
function toLeadIds(result: unknown): number[] {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return [];
  const ids = (result as { LEAD?: unknown }).LEAD;
  if (!Array.isArray(ids)) return [];
  return ids
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
}

/** `crm.item.add` answers `{ item: { id, ... } }`. */
function toItemId(result: unknown): number | undefined {
  if (result === null || typeof result !== 'object') return undefined;
  const { item } = result as { item?: { id?: unknown } };
  const id = Number(item?.id);
  return Number.isInteger(id) ? id : undefined;
}
