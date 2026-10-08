import type {
  BitrixLeadItem,
  DuplicateQuery,
  LeadWriteOp,
  LeadWriteResult,
} from '../../types/index.js';

type FakeLead = {
  id: number;
  email?: string;
  phone?: string;
  fields: Record<string, unknown>;
};

type WriteFault = { error: Error; applied?: boolean };

/**
 * In-memory Bitrix24 with the public surface of BitrixLeadGateway. Records the size of every
 * call and lets a test inject failures: before the write is applied (a rejected request) or
 * after it (a timeout: Bitrix24 did the work but the answer never arrived).
 */
export class FakeLeadGateway {
  leads = new Map<number, FakeLead>();
  nextId = 1000;
  calls = { mode: 0, fields: 0, find: 0, get: 0, write: 0 };
  /** Portal users by email; `usersError` makes the lookup throw (e.g. missing `user` scope). */
  users = new Map<string, number>();
  usersError: Error | undefined;
  userLookups: string[][] = [];
  findSizes: number[] = [];
  writeSizes: number[] = [];
  fieldNames = new Set([
    'title',
    'name',
    'companyTitle',
    'utmSource',
    'opportunity',
    'currencyId',
    'stageId',
    'assignedById',
    'comments',
    'originatorId',
  ]);
  /** False puts the portal in simple CRM mode: Bitrix24 converts every new lead at once. */
  leadsEnabled = true;
  /** Per-row error of the write batch, by row number. */
  rejectRows = new Map<number, { code: string; message: string }>();
  /** Called with the 1-based number of the write call; return a fault to make that call throw. */
  onWrite: ((call: number, ops: LeadWriteOp[]) => WriteFault | undefined) | undefined;
  /** Thrown by every duplicate search while set. */
  findError: Error | undefined;
  /** A write waits for this promise first: lets a test keep a run "in progress". */
  gate: Promise<void> | undefined;

  seed(lead: Omit<FakeLead, 'id' | 'fields'> & { fields?: Record<string, unknown> }): number {
    const id = this.nextId++;
    this.leads.set(id, { id, email: lead.email, phone: lead.phone, fields: lead.fields ?? {} });
    return id;
  }

  usesLeads(): Promise<boolean> {
    this.calls.mode += 1;
    return Promise.resolve(this.leadsEnabled);
  }

  findUsersByEmail(emails: string[]): Promise<Map<string, number>> {
    this.userLookups.push(emails);
    if (this.usersError) return Promise.reject(this.usersError);
    const found = new Map<string, number>();
    for (const email of emails) {
      const id = this.users.get(email);
      if (id !== undefined) found.set(email, id);
    }
    return Promise.resolve(found);
  }

  deleteLeads(ids: number[]): Promise<void> {
    for (const id of ids) this.leads.delete(id);
    return Promise.resolve();
  }

  getFieldNames(): Promise<Set<string>> {
    this.calls.fields += 1;
    return Promise.resolve(new Set(this.fieldNames));
  }

  findDuplicates(queries: DuplicateQuery[]): Promise<Map<string, number[]>> {
    const found = new Map<string, number[]>();
    if (!queries.length) return Promise.resolve(found);
    this.calls.find += 1;
    this.findSizes.push(queries.length);
    if (this.findError) return Promise.reject(this.findError);

    for (const query of queries) {
      const ids = [...this.leads.values()]
        .filter((lead) => (query.type === 'EMAIL' ? lead.email : lead.phone) === query.value)
        .map((lead) => lead.id);
      found.set(query.key, ids);
    }
    return Promise.resolve(found);
  }

  getLeads(ids: number[]): Promise<Map<number, BitrixLeadItem>> {
    const leads = new Map<number, BitrixLeadItem>();
    if (!ids.length) return Promise.resolve(leads);
    this.calls.get += 1;
    for (const id of ids) {
      const lead = this.leads.get(id);
      if (!lead) continue;
      const fm = [
        ...(lead.phone
          ? [{ id: id * 10 + 1, typeId: 'PHONE', valueType: 'WORK', value: lead.phone }]
          : []),
        ...(lead.email
          ? [{ id: id * 10 + 2, typeId: 'EMAIL', valueType: 'WORK', value: lead.email }]
          : []),
      ];
      leads.set(id, { id, fm, ...lead.fields });
    }
    return Promise.resolve(leads);
  }

  async write(ops: LeadWriteOp[]): Promise<Map<number, LeadWriteResult>> {
    if (!ops.length) return new Map();
    this.calls.write += 1;
    this.writeSizes.push(ops.length);
    await this.gate;

    const fault = this.onWrite?.(this.calls.write, ops);
    if (fault && !fault.applied) throw fault.error;
    const results = this.apply(ops);
    if (fault) throw fault.error;
    return results;
  }

  private apply(ops: LeadWriteOp[]): Map<number, LeadWriteResult> {
    const results = new Map<number, LeadWriteResult>();
    for (const op of ops) {
      const { rowNumber, fields, email, phone } = op.row;
      const rejection = this.rejectRows.get(rowNumber);
      if (rejection) {
        results.set(rowNumber, { ok: false, ...rejection });
        continue;
      }
      if (op.action === 'create') {
        const id = this.nextId++;
        this.leads.set(id, { id, email, phone, fields: { ...fields } });
        results.set(rowNumber, { ok: true, leadId: id });
        continue;
      }
      const lead = op.leadId === undefined ? undefined : this.leads.get(op.leadId);
      if (!lead) {
        results.set(rowNumber, { ok: false, code: 'NOT_FOUND', message: 'Item not found' });
        continue;
      }
      lead.fields = { ...lead.fields, ...fields };
      lead.email = email ?? lead.email;
      lead.phone = phone ?? lead.phone;
      results.set(rowNumber, { ok: true, leadId: lead.id });
    }
    return results;
  }
}
