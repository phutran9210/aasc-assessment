import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BitrixApiService } from '../../bitrix/services/bitrix-api.service.js';
import { BitrixHttpError } from '../../bitrix/services/bitrix-http-transport.service.js';
import type {
  CrmCandidateQuery,
  CrmFieldMetadata,
  CrmGateway,
  CrmMetadata,
  CrmStage,
  CrmUser,
  RemoteDeal,
  RemoteLead,
  TimelineEntry,
  TimelineInput,
} from '../ports/crm-gateway.port.js';
import type { ExternalId } from '../types/integration.types.js';

const LEAD_TYPE_ID = 1;
const DEAL_TYPE_ID = 2;
const EXTERNAL_ID_FIELD = 'UF_CRM_TIKTOK_EXTERNAL_ID';

@Injectable()
export class BitrixCrmGateway implements CrmGateway {
  constructor(private readonly api: BitrixApiService) {}

  async metadata(): Promise<CrmMetadata> {
    const [leadFields, dealFields, categories, users] = await Promise.all([
      this.call('crm.item.fields', { entityTypeId: LEAD_TYPE_ID, useOriginalUfNames: 'Y' }),
      this.call('crm.item.fields', { entityTypeId: DEAL_TYPE_ID, useOriginalUfNames: 'Y' }),
      this.call('crm.category.list', { entityTypeId: DEAL_TYPE_ID }),
      this.call('user.get', {
        FILTER: { ACTIVE: 'Y' },
        select: ['ID', 'NAME', 'LAST_NAME', 'ACTIVE'],
      }),
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
          semantic:
            typeof extra?.SEMANTICS === 'string'
              ? extra.SEMANTICS
              : typeof item.SEMANTICS === 'string'
                ? item.SEMANTICS
                : null,
        };
      }),
    );
    return {
      lead: { entityTypeId: LEAD_TYPE_ID, fields: this.parseFields(leadFields) },
      deal: { entityTypeId: DEAL_TYPE_ID, fields: this.parseFields(dealFields) },
      stages: parsedStages,
      users: listValue(users).map((value): CrmUser => {
        const item = this.record(value);
        const id = externalId(item.ID, 'user id');
        const name = [item.NAME, item.LAST_NAME]
          .filter((part) => typeof part === 'string')
          .join(' ');
        return { id, name, active: item.ACTIVE === true || item.ACTIVE === 'Y' };
      }),
    };
  }

  async findLeadCandidates(query: CrmCandidateQuery): Promise<RemoteLead[]> {
    const response = await this.call('crm.item.list', {
      entityTypeId: LEAD_TYPE_ID,
      filter: this.filter(query),
      select: ['*', EXTERNAL_ID_FIELD],
      order: { id: 'ASC' },
      start: this.offset(query),
    });
    return listValue(this.record(response).items ?? response)
      .slice(0, this.limit(query))
      .map((item) => this.parseLead(item));
  }

  async getLead(id: ExternalId): Promise<RemoteLead> {
    const response = await this.call('crm.item.get', { entityTypeId: LEAD_TYPE_ID, id });
    const item = response === null ? null : (this.record(response).item ?? response);
    if (!item) throw new NotFoundException('Bitrix lead was not found');
    return this.parseLead(item);
  }

  async createLead(fields: Record<string, unknown>, marker: ExternalId): Promise<RemoteLead> {
    const response = await this.call('crm.item.add', {
      entityTypeId: LEAD_TYPE_ID,
      fields: { ...fields, [EXTERNAL_ID_FIELD]: marker },
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
    });
    return this.parseLead(this.record(response).item ?? response);
  }

  async findDeals(query: CrmCandidateQuery): Promise<RemoteDeal[]> {
    const response = await this.call('crm.item.list', {
      entityTypeId: DEAL_TYPE_ID,
      filter: this.filter(query),
      select: ['*', EXTERNAL_ID_FIELD],
      order: { id: 'ASC' },
      start: this.offset(query),
    });
    return listValue(this.record(response).items ?? response)
      .slice(0, this.limit(query))
      .map((item) => this.parseDeal(item));
  }

  async getDeal(id: ExternalId): Promise<RemoteDeal> {
    const response = await this.call('crm.item.get', { entityTypeId: DEAL_TYPE_ID, id });
    const item = response === null ? null : (this.record(response).item ?? response);
    if (!item) throw new NotFoundException('Bitrix deal was not found');
    return this.parseDeal(item);
  }

  async createDeal(fields: Record<string, unknown>, marker: ExternalId): Promise<RemoteDeal> {
    const response = await this.call('crm.item.add', {
      entityTypeId: DEAL_TYPE_ID,
      fields: { ...fields, [EXTERNAL_ID_FIELD]: marker },
    });
    const deal = this.parseDeal(this.record(response).item ?? response);
    if (deal.marker !== marker)
      throw new TypeError('Bitrix deal response did not retain its external marker');
    return deal;
  }

  async completeLead(id: ExternalId, stage: string): Promise<RemoteLead> {
    return this.updateLead(id, { statusId: stage });
  }

  async findTimeline(marker: ExternalId): Promise<TimelineEntry[]> {
    const response = await this.call('crm.timeline.comment.list', { filter: { marker } });
    const values = Array.isArray(response) ? response : this.record(response).items;
    return listValue(values).map((value) => {
      const item = this.record(value);
      const entityType = item.ENTITY_TYPE ?? item.entityType;
      if (entityType !== 'lead' && entityType !== 'deal')
        throw new TypeError('Invalid timeline entity type');
      return {
        id: externalId(item.ID ?? item.id, 'timeline id'),
        entityType,
        entityId: externalId(item.ENTITY_ID ?? item.entityId, 'timeline entity id'),
        marker: requiredString(item.MARKER ?? item.marker, 'timeline marker'),
        comment: requiredString(item.COMMENT ?? item.comment, 'timeline comment'),
      };
    });
  }

  async addTimeline(input: TimelineInput): Promise<TimelineEntry> {
    const response = await this.call('crm.timeline.comment.add', {
      fields: {
        ENTITY_TYPE: input.entityType,
        ENTITY_ID: input.entityId,
        MARKER: input.marker,
        COMMENT: input.comment,
      },
    });
    const item = this.record(response).item ?? response;
    return {
      id: externalId(this.record(item).id ?? this.record(item).ID, 'timeline id'),
      ...input,
    };
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
        throw new BadGatewayException('Bitrix CRM request failed');
      }
      throw error;
    }
  }

  private filter(query: CrmCandidateQuery): Record<string, string> {
    const filter: Record<string, string> = {};
    if (query.marker) filter[`=${EXTERNAL_ID_FIELD}`] = query.marker;
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
        return [
          name,
          {
            name,
            title: typeof item.title === 'string' ? item.title : name,
            type: requiredString(item.type, `field ${name} type`),
            required: optionalBoolean(item.isRequired, `${name} required`),
            readOnly: optionalBoolean(item.isReadOnly, `${name} read only`),
            multiple: optionalBoolean(item.isMultiple, `${name} multiple`),
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
      marker:
        typeof item[EXTERNAL_ID_FIELD] === 'string'
          ? item[EXTERNAL_ID_FIELD]
          : typeof item.marker === 'string'
            ? item.marker
            : null,
      fields,
      ...(item.stale === true ? { stale: true } : {}),
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
      marker:
        typeof item[EXTERNAL_ID_FIELD] === 'string'
          ? item[EXTERNAL_ID_FIELD]
          : typeof item.marker === 'string'
            ? item.marker
            : null,
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
