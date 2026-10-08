import type {
  CrmFieldMetadata,
  RemoteDeal,
  RemoteLead,
  TimelineEntry,
  TimelineInput,
} from '../../crm-integration/ports/crm-gateway.port.js';

export type ProviderFault =
  'persist_then_timeout' | 'rate_limit' | 'auth_invalid' | 'stale_snapshot';
export type MockRestResponse = { status: number; body: Record<string, unknown>; hang?: boolean };

const FIELD = (name: string, type: string, title = name): CrmFieldMetadata => ({
  name,
  title,
  type,
  required: false,
  readOnly: false,
  multiple: false,
});

export class BitrixStore {
  private nextLeadId = 1;
  private nextDealId = 1;
  private nextTimelineId = 1;
  private readonly leads = new Map<string, RemoteLead>();
  private readonly deals = new Map<string, RemoteDeal>();
  private readonly timelines: TimelineEntry[] = [];
  private readonly faults = new Map<string, ProviderFault[]>();
  readonly calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  pageSize = 2;

  injectFault(method: string, fault: ProviderFault): void {
    const queue = this.faults.get(method) ?? [];
    queue.push(fault);
    this.faults.set(method, queue);
  }

  execute(method: string, payload: Record<string, unknown>): MockRestResponse {
    this.calls.push({ method, payload: structuredClone(payload) });
    const fault = this.faults.get(method)?.shift();
    if (fault === 'rate_limit') {
      return {
        status: 429,
        body: { error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Mock rate limit' },
      };
    }
    if (fault === 'auth_invalid') {
      return {
        status: 401,
        body: { error: 'INVALID_CREDENTIALS', error_description: 'Mock auth invalid' },
      };
    }

    const result = this.apply(method, payload, fault === 'stale_snapshot');
    return { status: 200, body: { result }, hang: fault === 'persist_then_timeout' };
  }

  private apply(method: string, payload: Record<string, unknown>, stale: boolean): unknown {
    switch (method) {
      case 'crm.item.fields':
        return { fields: this.fields(Number(payload.entityTypeId)) };
      case 'crm.item.list':
        return this.listItems(Number(payload.entityTypeId), payload);
      case 'crm.item.get': {
        const item = this.items(Number(payload.entityTypeId)).get(String(payload.id));
        if (!item) return null;
        return { item: stale ? { ...item, stale: true } : item };
      }
      case 'crm.item.add':
        return { item: this.addItem(Number(payload.entityTypeId), this.record(payload.fields)) };
      case 'crm.item.update':
        return {
          item: this.updateItem(
            Number(payload.entityTypeId),
            String(payload.id),
            this.record(payload.fields),
          ),
        };
      case 'crm.category.list':
        return {
          categories: [
            { id: 0, name: 'General' },
            { id: 1, name: 'Sales' },
          ],
        };
      case 'crm.status.list':
        return this.stages(stringValue(this.record(payload.filter).ENTITY_ID, 'DEAL_STAGE'));
      case 'user.get':
        return [{ ID: '1', NAME: 'Demo Sales', LAST_NAME: 'User', ACTIVE: true }];
      case 'crm.timeline.comment.list':
        return this.timelines.filter(
          (entry) => entry.marker === String(this.record(payload.filter).marker),
        );
      case 'crm.timeline.comment.add':
        return this.addTimeline(this.record(payload.fields));
      default:
        return null;
    }
  }

  private fields(entityTypeId: number): Record<string, CrmFieldMetadata> {
    const common = {
      id: FIELD('id', 'integer', 'ID'),
      title: FIELD('title', 'string', 'Title'),
      name: FIELD('name', 'string', 'Name'),
      fm: FIELD('fm', 'crm_multifield', 'Phone and email'),
      UF_CRM_TIKTOK_EXTERNAL_ID: FIELD('UF_CRM_TIKTOK_EXTERNAL_ID', 'string', 'External ID'),
    };
    return entityTypeId === 1
      ? common
      : {
          ...common,
          categoryId: FIELD('categoryId', 'crm_category'),
          stageId: FIELD('stageId', 'crm_status'),
          opportunity: FIELD('opportunity', 'double'),
          contactIds: FIELD('contactIds', 'crm_contact'),
        };
  }

  private stages(entityId: string): Array<Record<string, unknown>> {
    const categoryId = entityId === 'DEAL_STAGE' ? 0 : Number(entityId.replace('DEAL_STAGE_', ''));
    return categoryId === 0
      ? [
          { STATUS_ID: 'NEW', NAME: 'New', EXTRA: { SEMANTICS: null } },
          { STATUS_ID: 'IN_PROGRESS', NAME: 'In progress', EXTRA: { SEMANTICS: null } },
          { STATUS_ID: 'WON', NAME: 'Won', EXTRA: { SEMANTICS: 'S' } },
        ]
      : [
          {
            STATUS_ID: `C${categoryId}:NEW`,
            NAME: 'Pipeline new',
            EXTRA: { SEMANTICS: null },
          },
        ];
  }

  private listItems(entityTypeId: number, payload: Record<string, unknown>): unknown {
    const filter = this.record(payload.filter);
    const items = [...this.items(entityTypeId).values()].filter((item) => {
      const marker = filter['=UF_CRM_TIKTOK_EXTERNAL_ID'];
      if (typeof marker === 'string' && item.marker !== marker) return false;
      const email = filter['=EMAIL'];
      if (typeof email === 'string' && item.fields.email !== email) return false;
      const phone = filter['=PHONE'];
      if (typeof phone === 'string' && item.fields.phone !== phone) return false;
      return true;
    });
    const start = Number(payload.start ?? 0);
    return { items: items.slice(start, start + this.pageSize), total: items.length };
  }

  private addItem(entityTypeId: number, fields: Record<string, unknown>): RemoteLead | RemoteDeal {
    const marker = stringValue(fields.UF_CRM_TIKTOK_EXTERNAL_ID);
    if (entityTypeId === 1) {
      const item: RemoteLead = {
        id: String(this.nextLeadId++),
        title: stringValue(fields.title),
        marker: marker || null,
        fields,
      };
      this.leads.set(item.id, item);
      return item;
    }
    const item: RemoteDeal = {
      id: String(this.nextDealId++),
      title: stringValue(fields.title),
      marker: marker || null,
      fields,
    };
    this.deals.set(item.id, item);
    return item;
  }

  private updateItem(
    entityTypeId: number,
    id: string,
    patch: Record<string, unknown>,
  ): RemoteLead | RemoteDeal | null {
    const target = this.items(entityTypeId);
    const current = target.get(id);
    if (!current) return null;
    const fields = { ...current.fields, ...patch };
    const updated = {
      ...current,
      title: stringValue(fields.title, current.title),
      marker: stringValue(fields.UF_CRM_TIKTOK_EXTERNAL_ID, current.marker ?? '') || null,
      fields,
    };
    target.set(id, updated);
    return updated;
  }

  private addTimeline(fields: Record<string, unknown>): TimelineEntry {
    const input: TimelineInput = {
      entityType: fields.ENTITY_TYPE === 'deal' ? 'deal' : 'lead',
      entityId: stringValue(fields.ENTITY_ID),
      marker: stringValue(fields.MARKER),
      comment: stringValue(fields.COMMENT),
    };
    const entry = { id: String(this.nextTimelineId++), ...input };
    this.timelines.push(entry);
    return entry;
  }

  private items(entityTypeId: number): Map<string, RemoteLead | RemoteDeal> {
    return entityTypeId === 1 ? this.leads : this.deals;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
