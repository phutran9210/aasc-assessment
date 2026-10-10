import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { BitrixApiService } from '@modules/bitrix/services/bitrix-api.service.js';
import { BitrixHttpError } from '@modules/bitrix/services/bitrix-http-transport.service.js';
import type {
  CrmCandidateQuery,
  DealPageQuery,
  CrmFieldMetadata,
  CrmGateway,
  CrmMetadata,
  CrmStage,
  CrmUser,
  RemoteDeal,
  RemoteLead,
  TimelineEntry,
  TimelineInput,
  TimelineQuery,
} from '../ports/crm-gateway.port.js';
import { REMOTE_ORIGINATOR, remoteMarkerFields } from '../constants/flow.constants.js';
import type { ExternalId } from '../types/integration.types.js';

const LEAD_TYPE_ID = 1;
const DEAL_TYPE_ID = 2;
// Custom fields keep their `UF_CRM_...` names in requests and answers, as mappings name them.
const ORIGINAL_NAMES = { useOriginalUfNames: 'Y' } as const;
const TIMELINE_MARKER_PREFIX = 'ref: ';

@Injectable()
export class BitrixCrmGateway implements CrmGateway {
  constructor(private readonly api: BitrixApiService) {}

  async metadata(): Promise<CrmMetadata> {
    const [leadFields, dealFields, categories, users] = await Promise.all([
      this.call('crm.item.fields', { entityTypeId: LEAD_TYPE_ID, useOriginalUfNames: 'Y' }),
      this.call('crm.item.fields', { entityTypeId: DEAL_TYPE_ID, useOriginalUfNames: 'Y' }),
      this.call('crm.category.list', { entityTypeId: DEAL_TYPE_ID }),
      this.users(),
    ]);
    const categoryIds = listValue(this.record(categories).categories).map((value) =>
      safeInteger(this.record(value).id, 'category id'),
    );
    const stageLists = await Promise.all(
      categoryIds.map(async (categoryId) => ({
        categoryId,
        values: await this.call('crm.status.list', {
          filter: { ENTITY_ID: categoryId > 0 ? `DEAL_STAGE_${categoryId}` : 'DEAL_STAGE' },
          order: { SORT: 'ASC' },
        }),
      })),
    );
    const parsedStages = stageLists.flatMap(({ categoryId, values }) =>
      listValue(values).map((value): CrmStage => {
        const item = this.record(value);
        const extra = this.optionalRecord(item.EXTRA);
        return {
          id: requiredString(item.STATUS_ID, 'stage id'),
          name: requiredString(item.NAME, 'stage name'),
          categoryId,
          semantic: stageSemantic(extra?.SEMANTICS ?? item.SEMANTICS),
        };
      }),
    );
    return {
      lead: { entityTypeId: LEAD_TYPE_ID, fields: this.parseFields(leadFields) },
      deal: { entityTypeId: DEAL_TYPE_ID, fields: this.parseFields(dealFields) },
      stages: parsedStages,
      users,
    };
  }

  /**
   * Active users, to validate configured assignees. Listing users needs the `user` scope; a
   * connection that only has `crm` still knows its own user through `profile`, so only that user
   * can be validated as an assignee.
   */
  private async users(): Promise<CrmUser[]> {
    let rows: unknown[];
    try {
      rows = listValue(
        await this.call('user.get', {
          FILTER: { ACTIVE: 'Y' },
          select: ['ID', 'NAME', 'LAST_NAME', 'ACTIVE'],
        }),
      );
    } catch (error) {
      if (!(error instanceof UnprocessableEntityException)) throw error;
      rows = [{ ...this.record(await this.call('profile', {})), ACTIVE: true }];
    }
    return rows.map((value): CrmUser => {
      const item = this.record(value);
      const name = [item.NAME, item.LAST_NAME].filter((part) => typeof part === 'string').join(' ');
      return {
        id: externalId(item.ID, 'user id'),
        name,
        active: item.ACTIVE === true || item.ACTIVE === 'Y',
      };
    });
  }

  async findLeadCandidates(query: CrmCandidateQuery): Promise<RemoteLead[]> {
    const response = await this.call('crm.item.list', {
      entityTypeId: LEAD_TYPE_ID,
      filter: this.filter(query),
      select: ['*', 'UF_*'],
      ...ORIGINAL_NAMES,
      order: { id: 'ASC' },
      start: this.offset(query),
    });
    return listValue(this.record(response).items ?? response)
      .slice(0, this.limit(query))
      .map((item) => this.parseLead(item));
  }

  async findLeadDuplicates(query: { email?: string; phone?: string }): Promise<RemoteLead[]> {
    const queries = [
      ...(query.email ? [{ type: 'EMAIL', value: query.email }] : []),
      ...(query.phone ? [{ type: 'PHONE', value: query.phone }] : []),
    ];
    const idGroups = await Promise.all(
      queries.map(async ({ type, value }) => {
        const response = await this.call('crm.duplicate.findbycomm', {
          entity_type: 'LEAD',
          type,
          values: [value],
        });
        const result = this.optionalRecord(response);
        const rawIds = result?.LEAD;
        if (!Array.isArray(rawIds)) return [];
        return rawIds.map((id) => externalId(id, 'duplicate lead id'));
      }),
    );
    const ids = [...new Set(idGroups.flat())];
    return Promise.all(ids.map((id) => this.getLead(id)));
  }

  async getLead(id: ExternalId): Promise<RemoteLead> {
    const response = await this.call('crm.item.get', {
      entityTypeId: LEAD_TYPE_ID,
      id,
      ...ORIGINAL_NAMES,
    });
    const item = response === null ? null : (this.record(response).item ?? response);
    if (!item) throw new NotFoundException('Bitrix lead was not found');
    return this.parseLead(item);
  }

  async createLead(fields: Record<string, unknown>, marker: ExternalId): Promise<RemoteLead> {
    const response = await this.call('crm.item.add', {
      entityTypeId: LEAD_TYPE_ID,
      fields: { ...fields, ...remoteMarkerFields(marker) },
      ...ORIGINAL_NAMES,
    });
    const lead = this.parseLead(this.record(response).item ?? response);
    if (lead.marker !== marker)
      throw new TypeError('Bitrix lead response did not retain its external marker');
    return lead;
  }

  async updateLead(id: ExternalId, patch: Record<string, unknown>): Promise<RemoteLead> {
    const response = await this.call('crm.item.update', {
      entityTypeId: LEAD_TYPE_ID,
      id,
      fields: patch,
      ...ORIGINAL_NAMES,
    });
    return this.parseLead(this.record(response).item ?? response);
  }

  async findDeals(query: CrmCandidateQuery): Promise<RemoteDeal[]> {
    const response = await this.call('crm.item.list', {
      entityTypeId: DEAL_TYPE_ID,
      filter: this.filter(query),
      select: ['*', 'UF_*'],
      ...ORIGINAL_NAMES,
      order: { id: 'ASC' },
      start: this.offset(query),
    });
    return listValue(this.record(response).items ?? response)
      .slice(0, this.limit(query))
      .map((item) => this.parseDeal(item));
  }

  async listDealsPage(query: DealPageQuery): Promise<RemoteDeal[]> {
    if (!Number.isSafeInteger(query.offset) || query.offset < 0)
      throw new RangeError('offset must be non-negative');
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50)
      throw new RangeError('limit must be 1..50');
    const filter: Record<string, string> = {};
    if (query.modifiedSince) filter['>=updatedTime'] = query.modifiedSince.toISOString();
    const response = await this.call('crm.item.list', {
      entityTypeId: DEAL_TYPE_ID,
      filter,
      select: ['*', 'UF_*'],
      ...ORIGINAL_NAMES,
      order: { id: 'ASC' },
      start: query.offset,
    });
    return listValue(this.record(response).items ?? response)
      .slice(0, query.limit)
      .map((item) => this.parseDeal(item));
  }

  async getDeal(id: ExternalId): Promise<RemoteDeal> {
    const response = await this.call('crm.item.get', {
      entityTypeId: DEAL_TYPE_ID,
      id,
      ...ORIGINAL_NAMES,
    });
    const item = response === null ? null : (this.record(response).item ?? response);
    if (!item) throw new NotFoundException('Bitrix deal was not found');
    return this.parseDeal(item);
  }

  async createDeal(fields: Record<string, unknown>, marker: ExternalId): Promise<RemoteDeal> {
    const response = await this.call('crm.item.add', {
      entityTypeId: DEAL_TYPE_ID,
      fields: { ...fields, ...remoteMarkerFields(marker) },
      ...ORIGINAL_NAMES,
    });
    const deal = this.parseDeal(this.record(response).item ?? response);
    if (deal.marker !== marker)
      throw new TypeError('Bitrix deal response did not retain its external marker');
    return deal;
  }

  async completeLead(id: ExternalId, stage: string): Promise<RemoteLead> {
    // In `crm.item` the lead status is the item's stage.
    return this.updateLead(id, { stageId: stage });
  }

  /**
   * Timeline comments have no field for an external ID and can only be listed per CRM record, so
   * the marker travels as the last line of the comment and is looked up there.
   */
  async findTimeline(query: TimelineQuery): Promise<TimelineEntry[]> {
    const response = await this.call('crm.timeline.comment.list', {
      filter: { ENTITY_ID: query.entityId, ENTITY_TYPE: query.entityType },
      select: ['ID', 'COMMENT'],
    });
    const suffix = `${TIMELINE_MARKER_PREFIX}${query.marker}`;
    return listValue(response).flatMap((value): TimelineEntry[] => {
      const item = this.record(value);
      const text = typeof item.COMMENT === 'string' ? item.COMMENT.trimEnd() : '';
      if (!text.endsWith(suffix)) return [];
      return [
        {
          id: externalId(item.ID, 'timeline id'),
          entityType: query.entityType,
          entityId: query.entityId,
          marker: query.marker,
          comment: text.slice(0, -suffix.length).trimEnd(),
        },
      ];
    });
  }

  async addTimeline(input: TimelineInput): Promise<TimelineEntry> {
    const response = await this.call('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: input.entityId,
        ENTITY_TYPE: input.entityType,
        COMMENT: `${input.comment}\n${TIMELINE_MARKER_PREFIX}${input.marker}`,
      },
    });
    return { id: externalId(response, 'timeline id'), ...input };
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.api.callRaw<unknown>(method, payload, {
        retryTransient: false,
        retryRateLimit: false,
      });
      return response.result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof BitrixHttpError) {
        if (error.timeout) throw new GatewayTimeoutException('Bitrix CRM request timed out');
        if (error.status === 429)
          throw new HttpException('Bitrix CRM rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
        if (error.code === 'NOT_FOUND') throw new NotFoundException('Bitrix item was not found');
        // Bitrix answered and refused: the request was not executed, unlike a 5xx or no answer.
        if (error.status !== undefined && error.status >= 400 && error.status < 500)
          throw new UnprocessableEntityException('Bitrix CRM rejected the request');
        throw new BadGatewayException('Bitrix CRM request failed');
      }
      throw error;
    }
  }

  private filter(query: CrmCandidateQuery): Record<string, string> {
    const filter: Record<string, string> = {};
    if (query.marker) {
      filter['=originatorId'] = REMOTE_ORIGINATOR;
      filter['=originId'] = query.marker;
    }
    if (query.leadId) filter['=leadId'] = query.leadId;
    if (query.email) filter['=EMAIL'] = query.email;
    if (query.phone) filter['=PHONE'] = query.phone;
    return filter;
  }

  private limit(query: CrmCandidateQuery): number {
    const limit = query.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new RangeError('limit must be 1..1000');
    return limit;
  }

  private offset(query: CrmCandidateQuery): number {
    const offset = query.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new RangeError('offset must be non-negative');
    return offset;
  }

  private parseFields(value: unknown): Record<string, CrmFieldMetadata> {
    const fields = this.record(this.record(value).fields ?? value);
    return Object.fromEntries(
      Object.entries(fields).map(([name, raw]) => {
        const item = this.record(raw);
        const settings = this.optionalRecord(item.settings);
        const maxLength = optionalSafeInteger(item.maxLength ?? settings?.MAX_LENGTH);
        return [
          name,
          {
            name,
            title: typeof item.title === 'string' ? item.title : name,
            type: requiredString(item.type, `field ${name} type`),
            required: optionalBoolean(item.isRequired, `${name} required`),
            readOnly: optionalBoolean(item.isReadOnly, `${name} read only`),
            multiple: optionalBoolean(item.isMultiple, `${name} multiple`),
            ...(maxLength !== null ? { maxLength } : {}),
          },
        ];
      }),
    );
  }

  private parseLead(value: unknown): RemoteLead {
    const item = this.record(value);
    const fields = this.optionalRecord(item.fields) ?? item;
    return {
      id: externalId(item.id ?? item.ID, 'lead id'),
      title:
        typeof item.title === 'string'
          ? item.title
          : typeof fields.title === 'string'
            ? fields.title
            : '',
      marker: ownMarker(fields),
      fields,
      ...(item.stale === true ? { stale: true } : {}),
      ...(hasForeignOrigin(fields) ? { foreignOrigin: true } : {}),
    };
  }

  private parseDeal(value: unknown): RemoteDeal {
    const item = this.record(value);
    const fields = this.optionalRecord(item.fields) ?? item;
    return {
      id: externalId(item.id ?? item.ID, 'deal id'),
      title:
        typeof item.title === 'string'
          ? item.title
          : typeof fields.title === 'string'
            ? fields.title
            : '',
      marker: ownMarker(fields),
      fields: { ...fields },
    };
  }

  private optionalRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Bitrix response object was invalid');
    }
    return value as Record<string, unknown>;
  }
}

/** Marker of a record this integration created or adopted; null for anyone else's record. */
function ownMarker(fields: Record<string, unknown>): ExternalId | null {
  return fields.originatorId === REMOTE_ORIGINATOR &&
    typeof fields.originId === 'string' &&
    fields.originId
    ? fields.originId
    : null;
}

function hasForeignOrigin(fields: Record<string, unknown>): boolean {
  return (
    typeof fields.originatorId === 'string' &&
    fields.originatorId !== '' &&
    fields.originatorId !== REMOTE_ORIGINATOR
  );
}

/** Bitrix24 names stage semantics `process`, `success`, `failure` and `apology`. */
function stageSemantic(value: unknown): string | null {
  if (value === 'success' || value === 'S') return 'won';
  if (value === 'failure' || value === 'apology' || value === 'F') return 'lost';
  return null;
}

function listValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Bitrix list response was invalid');
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`Bitrix ${label} was invalid`);
  return value;
}

function externalId(value: unknown, label: string): ExternalId {
  if (typeof value === 'string' && value.length > 0 && value.length <= 255) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new TypeError(`Bitrix ${label} was invalid`);
}

function safeInteger(value: unknown, label: string): number {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new TypeError(`Bitrix ${label} was invalid`);
  return number;
}

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new TypeError(`Bitrix ${label} was invalid`);
  return value;
}

function optionalSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000
    ? value
    : null;
}
