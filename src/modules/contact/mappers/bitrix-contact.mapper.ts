import type { CreateContactDto } from '../dto/create-contact.dto.js';
import type { UpdateContactDto } from '../dto/update-contact.dto.js';
import type { BitrixContactItem, ContactResponse, RelatedContactData } from '../types/index.js';

/* Bitrix REST payloads are dynamic at this integration boundary. */

// crm.item.* multifield shape: { id, typeId: 'PHONE' | 'EMAIL' | 'WEB', valueType, value }.
type Multifield = { id?: number | string; typeId?: string; valueType?: string; value?: string };

export function toCreateFields(dto: CreateContactDto): Record<string, unknown> {
  const fm: Multifield[] = [];
  if (dto.phone) fm.push({ typeId: 'PHONE', valueType: 'WORK', value: dto.phone });
  if (dto.email) fm.push({ typeId: 'EMAIL', valueType: 'WORK', value: dto.email });
  if (dto.website) fm.push({ typeId: 'WEB', valueType: 'WORK', value: dto.website });
  return fm.length ? { name: dto.name, fm } : { name: dto.name };
}

export function toUpdateFields(
  dto: UpdateContactDto,
  current: BitrixContactItem,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (dto.name !== undefined) {
    // The API exposes one name, so the full value goes to `name` and `lastName` is cleared.
    fields.name = dto.name;
    fields.lastName = '';
  }
  // crm.item.update replaces a multifield only when `fm` is an object keyed by the remote id;
  // an array (even with ids) appends new values. New values use the keys n0, n1, ...
  const fm: Record<string, Multifield> = {};
  let added = 0;
  const set = (typeId: string, value: string | undefined): void => {
    if (value === undefined) return;
    const existing = getMultifields(current, typeId)[0];
    const key = existing?.id !== undefined ? String(existing.id) : `n${added++}`;
    fm[key] = { typeId, valueType: 'WORK', value };
  };
  set('PHONE', dto.phone);
  set('EMAIL', dto.email);
  set('WEB', dto.website);
  if (Object.keys(fm).length) fields.fm = fm;
  return fields;
}

export function fromBitrixItem(
  item: BitrixContactItem,
  related: RelatedContactData = {},
): ContactResponse {
  const phone = getMultifields(item, 'PHONE')[0]?.value;
  const email = getMultifields(item, 'EMAIL')[0]?.value;
  const website = getMultifields(item, 'WEB')[0]?.value;
  const address = related.address
    ? {
        ward: asText(related.address.ADDRESS_1),
        district: asText(related.address.REGION),
        province: asText(related.address.PROVINCE),
      }
    : null;
  const bank = related.bank
    ? {
        bankName: asText(related.bank.RQ_BANK_NAME ?? related.bank.NAME),
        accountNumber: asText(related.bank.RQ_ACC_NUM),
      }
    : null;
  return {
    id: String(item.id),
    name: [asText(item.name), asText(item.lastName)].filter(Boolean).join(' '),
    phone,
    email,
    website,
    address,
    bank,
  };
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function getMultifields(item: BitrixContactItem, typeId: string): Multifield[] {
  const fm = Array.isArray(item.fm) ? (item.fm as Multifield[]) : [];
  return fm.filter((field) => field.typeId === typeId);
}
