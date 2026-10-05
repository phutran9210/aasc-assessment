import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PaginatedResponse } from '@common/types/index.js';
import { buildPaginationMeta } from '@common/utils/index.js';
import { bitrixConfig } from '@config/index.js';

import { BitrixApiService } from '@modules/bitrix/services/bitrix-api.service.js';

import {
  BITRIX_PAGE_SIZE,
  CONTACT_ENTITY_TYPE_ID,
  PHYSICAL_ADDRESS_TYPE_ID,
  REQUISITE_ADDRESS_ENTITY_TYPE_ID,
  REQUISITE_ENTITY_TYPE_ID,
} from '../constants/index.js';
import type { CreateContactDto } from '../dto/create-contact.dto.js';
import type { ContactQueryDto } from '../dto/contact-query.dto.js';
import type { UpdateContactDto } from '../dto/update-contact.dto.js';
import {
  fromBitrixItem,
  toCreateFields,
  toUpdateFields,
} from '../mappers/bitrix-contact.mapper.js';
import { CONTACT_MESSAGES } from '../messages/index.js';
import type {
  BitrixContactItem,
  BitrixValue,
  ContactResponse,
  RelatedContactData,
} from '../types/index.js';

type BitrixConfig = { requisitePresetId?: number };
// crm.requisite.*, crm.address.* and bankdetail list methods return a bare array in `result`.
type BitrixListResult = BitrixValue[] | { items?: BitrixValue[] };

/**
 * Contact CRUD on top of Bitrix24. A contact is a CRM item (entityTypeId 3); its address and
 * bank details hang off a requisite created from the configured preset.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly api: BitrixApiService,
    @Inject(bitrixConfig.KEY) private readonly config: BitrixConfig,
  ) {}

  /** One page of contacts, each with the address and bank details of its requisite. */
  async findAll(query: ContactQueryDto): Promise<PaginatedResponse<ContactResponse>> {
    const { page, limit } = query;
    // crm.item.list serves fixed blocks of 50 and only honours `start` at block boundaries,
    // so the requested page is cut out of the block(s) that contain it.
    const offset = (page - 1) * limit;
    const collected: BitrixContactItem[] = [];
    let total: number | undefined;
    let start = Math.floor(offset / BITRIX_PAGE_SIZE) * BITRIX_PAGE_SIZE;
    const skip = offset - start;
    while (collected.length < skip + limit) {
      const response = await this.api.callBitrixApiWithTotal<{ items?: BitrixContactItem[] }>(
        'crm.item.list',
        { entityTypeId: CONTACT_ENTITY_TYPE_ID, select: ['*'], start },
      );
      const block = response.result.items ?? [];
      total = response.total ?? total;
      collected.push(...block);
      if (block.length < BITRIX_PAGE_SIZE) break;
      start += BITRIX_PAGE_SIZE;
    }
    const items = collected.slice(skip, skip + limit);
    const related = await this.findRelatedForPage(items.map((item) => Number(item.id)));
    const data = items.map((item) =>
      fromBitrixItem(item, related.get(Number(item.id)) ?? { address: null, bank: null }),
    );
    return { data, meta: buildPaginationMeta(total ?? collected.length, page, limit) };
  }

  /**
   * Creates the contact, then requisite, address and bank details. If a later step fails, what
   * was already created is deleted again so no half-built contact is left in Bitrix24.
   */
  async create(dto: CreateContactDto): Promise<ContactResponse> {
    const created = await this.api.callBitrixApi<{
      item?: BitrixContactItem;
      id?: number | string;
    }>('crm.item.add', {
      entityTypeId: CONTACT_ENTITY_TYPE_ID,
      fields: toCreateFields(dto),
    });
    const contactId = extractRemoteId(created);
    if (!Number.isInteger(contactId))
      throw new ServiceUnavailableException(CONTACT_MESSAGES.ERROR.CONTACT_ID_MISSING);
    let requisiteId: number | undefined;
    let bankId: number | undefined;
    try {
      if (dto.address || dto.bank) {
        requisiteId = await this.addRequisite(contactId, dto.name);
        if (dto.address) await this.addAddress(requisiteId, dto.address);
        if (dto.bank) bankId = await this.addBank(requisiteId, dto.bank);
      }
      const item = created.item ?? { id: contactId, name: dto.name };
      return fromBitrixItem(item, {
        address: dto.address
          ? {
              ADDRESS_1: dto.address.ward,
              REGION: dto.address.district,
              PROVINCE: dto.address.province,
            }
          : null,
        bank: dto.bank
          ? { RQ_BANK_NAME: dto.bank.bankName, RQ_ACC_NUM: dto.bank.accountNumber }
          : null,
      });
    } catch (error) {
      await this.compensate(contactId, requisiteId, bankId);
      throw error;
    }
  }

  /** Changes the given fields; address/bank are updated in place or created when missing. */
  async update(id: string, dto: UpdateContactDto): Promise<ContactResponse> {
    const contactId = Number(id);
    const current = await this.getContact(contactId);
    const fields = toUpdateFields(dto, current);
    if (Object.keys(fields).length) {
      await this.api.callBitrixApi('crm.item.update', {
        entityTypeId: CONTACT_ENTITY_TYPE_ID,
        id: contactId,
        fields,
      });
    }
    const requisite = await this.findRequisite(contactId);
    if (requisite && (dto.address || dto.bank)) await this.updateRelated(requisite, dto);
    else if (!requisite && (dto.address || dto.bank)) {
      const requisiteId = await this.addRequisite(
        contactId,
        dto.name ?? fromBitrixItem(current).name,
      );
      if (dto.address) await this.addAddress(requisiteId, dto.address);
      if (dto.bank) await this.addBank(requisiteId, dto.bank);
    }
    const refreshed = await this.getContact(contactId);
    return this.toResponse(refreshed);
  }

  /** Deletes the requisite (Bitrix24 removes its address and bank details), then the contact. */
  async remove(id: string): Promise<void> {
    const contactId = Number(id);
    await this.getContact(contactId);
    const requisite = await this.findRequisite(contactId);
    if (requisite)
      await this.api.callBitrixApi('crm.requisite.delete', {
        id: Number(requisite.ID ?? requisite.id),
      });
    await this.api.callBitrixApi('crm.item.delete', {
      entityTypeId: CONTACT_ENTITY_TYPE_ID,
      id: contactId,
    });
  }

  private async getContact(id: number): Promise<BitrixContactItem> {
    try {
      const response = await this.api.callBitrixApi<{ item?: BitrixContactItem | null }>(
        'crm.item.get',
        {
          entityTypeId: CONTACT_ENTITY_TYPE_ID,
          id,
        },
      );
      if (!response.item) throw new NotFoundException(CONTACT_MESSAGES.ERROR.NOT_FOUND);
      return response.item;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(CONTACT_MESSAGES.ERROR.NOT_FOUND);
      }
      throw error;
    }
  }

  private async toResponse(item: BitrixContactItem): Promise<ContactResponse> {
    const requisite = await this.findRequisite(Number(item.id));
    if (!requisite) return fromBitrixItem(item, { address: null, bank: null });
    const requisiteId = Number(requisite.ID ?? requisite.id);
    const [address, bank] = await Promise.all([
      this.findAddress(requisiteId),
      this.findBank(requisiteId),
    ]);
    return fromBitrixItem(item, { address, bank });
  }

  /**
   * Loads requisite, address and bank detail for a whole page in three calls (ID arrays in the
   * filters) instead of three calls per contact, which quickly hits the Bitrix24 rate limit.
   */
  private async findRelatedForPage(contactIds: number[]): Promise<Map<number, RelatedContactData>> {
    const related = new Map<number, RelatedContactData>();
    const presetId = this.config.requisitePresetId;
    if (!presetId || !contactIds.length) return related;

    const requisites = await this.listAll('crm.requisite.list', {
      ENTITY_TYPE_ID: REQUISITE_ENTITY_TYPE_ID,
      ENTITY_ID: contactIds,
      PRESET_ID: presetId,
    });
    // Same rule as findRequisite: the oldest active requisite of the contact.
    const requisiteByContact = new Map<number, number>();
    for (const requisite of requisites.sort(byId)) {
      const contactId = Number(requisite.ENTITY_ID);
      if (requisite.ACTIVE === 'N' || requisiteByContact.has(contactId)) continue;
      requisiteByContact.set(contactId, idOf(requisite));
    }
    const requisiteIds = [...requisiteByContact.values()];
    if (!requisiteIds.length) return related;

    const addresses = await this.listAll('crm.address.list', {
      ENTITY_TYPE_ID: REQUISITE_ADDRESS_ENTITY_TYPE_ID,
      ENTITY_ID: requisiteIds,
      TYPE_ID: PHYSICAL_ADDRESS_TYPE_ID,
    });
    const banks = await this.listAll('crm.requisite.bankdetail.list', { ENTITY_ID: requisiteIds });
    banks.sort(byId);

    for (const [contactId, requisiteId] of requisiteByContact) {
      related.set(contactId, {
        address: addresses.find((row) => Number(row.ENTITY_ID) === requisiteId) ?? null,
        bank: banks.find((row) => Number(row.ENTITY_ID) === requisiteId) ?? null,
      });
    }
    return related;
  }

  /** Reads every row of a Bitrix24 list method, following its 50-row blocks. */
  private async listAll(method: string, filter: Record<string, unknown>): Promise<BitrixValue[]> {
    const rows: BitrixValue[] = [];
    for (let start = 0; ; start += BITRIX_PAGE_SIZE) {
      const response = await this.api.callBitrixApiWithTotal<BitrixListResult>(method, {
        filter,
        start,
      });
      const block = asList(response.result);
      rows.push(...block);
      if (block.length < BITRIX_PAGE_SIZE || rows.length >= (response.total ?? 0)) return rows;
    }
  }

  private async findRequisite(contactId: number): Promise<BitrixValue | null> {
    const presetId = this.config.requisitePresetId;
    if (!presetId) return null;
    const response = await this.api.callBitrixApi<BitrixListResult>('crm.requisite.list', {
      filter: {
        ENTITY_TYPE_ID: REQUISITE_ENTITY_TYPE_ID,
        ENTITY_ID: contactId,
        PRESET_ID: presetId,
      },
      order: { ID: 'ASC' },
    });
    return (
      asList(response)
        .filter((x) => x.ACTIVE !== 'N')
        .sort((a, b) => Number(a.ID ?? a.id) - Number(b.ID ?? b.id))[0] ?? null
    );
  }

  private async findAddress(requisiteId: number): Promise<BitrixValue | null> {
    const response = await this.api.callBitrixApi<BitrixListResult>('crm.address.list', {
      filter: {
        ENTITY_TYPE_ID: REQUISITE_ADDRESS_ENTITY_TYPE_ID,
        ENTITY_ID: requisiteId,
        TYPE_ID: PHYSICAL_ADDRESS_TYPE_ID,
      },
    });
    return asList(response)[0] ?? null;
  }

  private async findBank(requisiteId: number): Promise<BitrixValue | null> {
    const response = await this.api.callBitrixApi<BitrixListResult>(
      'crm.requisite.bankdetail.list',
      {
        filter: { ENTITY_ID: requisiteId },
      },
    );
    return asList(response).sort((a, b) => Number(a.ID ?? a.id) - Number(b.ID ?? b.id))[0] ?? null;
  }

  private async addRequisite(contactId: number, name: string): Promise<number> {
    if (!this.config.requisitePresetId)
      throw new ServiceUnavailableException(CONTACT_MESSAGES.ERROR.CONFIG);
    const response = await this.api.callBitrixApi<{
      item?: BitrixValue;
      id?: number | string;
    }>('crm.requisite.add', {
      fields: {
        ENTITY_TYPE_ID: REQUISITE_ENTITY_TYPE_ID,
        ENTITY_ID: contactId,
        PRESET_ID: this.config.requisitePresetId,
        // NAME is mandatory for crm.requisite.add.
        NAME: name,
      },
    });
    return extractRemoteId(response);
  }

  private async addAddress(
    requisiteId: number,
    address: CreateContactDto['address'],
  ): Promise<void> {
    await this.api.callBitrixApi<boolean>('crm.address.add', {
      fields: {
        ENTITY_TYPE_ID: REQUISITE_ADDRESS_ENTITY_TYPE_ID,
        ENTITY_ID: requisiteId,
        TYPE_ID: PHYSICAL_ADDRESS_TYPE_ID,
        ADDRESS_1: address?.ward,
        REGION: address?.district,
        PROVINCE: address?.province,
      },
    });
  }

  private async addBank(requisiteId: number, bank: CreateContactDto['bank']): Promise<number> {
    const response = await this.api.callBitrixApi<{
      item?: BitrixValue;
      id?: number | string;
    }>('crm.requisite.bankdetail.add', {
      fields: {
        ENTITY_ID: requisiteId,
        NAME: bank?.bankName,
        RQ_BANK_NAME: bank?.bankName,
        RQ_ACC_NUM: bank?.accountNumber,
      },
    });
    return extractRemoteId(response);
  }

  private async updateRelated(requisite: BitrixValue, dto: UpdateContactDto): Promise<void> {
    const requisiteId = Number(requisite.ID ?? requisite.id);
    if (dto.address) {
      const existing = await this.findAddress(requisiteId);
      const fields = {
        ENTITY_TYPE_ID: REQUISITE_ADDRESS_ENTITY_TYPE_ID,
        ENTITY_ID: requisiteId,
        TYPE_ID: PHYSICAL_ADDRESS_TYPE_ID,
        ADDRESS_1: dto.address.ward,
        REGION: dto.address.district,
        PROVINCE: dto.address.province,
      };
      await this.api.callBitrixApi(existing ? 'crm.address.update' : 'crm.address.add', { fields });
    }
    if (dto.bank) {
      const existing = await this.findBank(requisiteId);
      const fields = {
        ENTITY_ID: requisiteId,
        NAME: dto.bank.bankName,
        RQ_BANK_NAME: dto.bank.bankName,
        RQ_ACC_NUM: dto.bank.accountNumber,
      };
      await this.api.callBitrixApi(
        existing ? 'crm.requisite.bankdetail.update' : 'crm.requisite.bankdetail.add',
        existing ? { id: Number(existing.ID ?? existing.id), fields } : { fields },
      );
    }
  }

  private async compensate(
    contactId: number,
    requisiteId?: number,
    bankId?: number,
  ): Promise<void> {
    try {
      if (bankId) await this.api.callBitrixApi('crm.requisite.bankdetail.delete', { id: bankId });
      if (requisiteId) await this.api.callBitrixApi('crm.requisite.delete', { id: requisiteId });
      await this.api.callBitrixApi('crm.item.delete', {
        entityTypeId: CONTACT_ENTITY_TYPE_ID,
        id: contactId,
      });
    } catch (cleanupError) {
      this.logger.error(
        `Bitrix24 compensation failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    }
  }
}

function idOf(row: BitrixValue): number {
  return Number(row.ID ?? row.id);
}

function byId(a: BitrixValue, b: BitrixValue): number {
  return idOf(a) - idOf(b);
}

function asList(response: BitrixListResult | null | undefined): BitrixValue[] {
  if (Array.isArray(response)) return response;
  return response?.items ?? [];
}

function extractRemoteId(value: unknown): number {
  if (typeof value === 'number' || typeof value === 'string') return Number(value);
  if (!value || typeof value !== 'object') return Number.NaN;
  const record = value as Record<string, unknown>;
  const item = record.item;
  if (typeof item === 'number' || typeof item === 'string') return Number(item);
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    return Number(itemRecord.ID ?? itemRecord.id);
  }
  return Number(record.ID ?? record.id);
}
