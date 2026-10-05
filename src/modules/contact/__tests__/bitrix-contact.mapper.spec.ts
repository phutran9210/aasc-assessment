import {
  fromBitrixItem,
  toCreateFields,
  toUpdateFields,
} from '../mappers/bitrix-contact.mapper.js';

describe('BitrixContactMapper', () => {
  it('should map create contact points to Bitrix fm fields', () => {
    expect(
      toCreateFields({
        name: 'A',
        phone: '+84123',
        email: 'a@example.com',
        website: 'https://a.test',
      }),
    ).toEqual({
      name: 'A',
      fm: [
        { typeId: 'PHONE', valueType: 'WORK', value: '+84123' },
        { typeId: 'EMAIL', valueType: 'WORK', value: 'a@example.com' },
        { typeId: 'WEB', valueType: 'WORK', value: 'https://a.test' },
      ],
    });
  });

  it('should map remote multifields and requisite details to response', () => {
    expect(
      fromBitrixItem(
        {
          id: 7,
          name: 'A',
          lastName: null,
          fm: [
            { id: 12, typeId: 'EMAIL', valueType: 'WORK', value: 'a@example.com' },
            { id: 11, typeId: 'PHONE', valueType: 'WORK', value: '123' },
            { id: 13, typeId: 'WEB', valueType: 'WORK', value: 'https://a.test' },
          ],
        },
        {
          address: { ID: 20, ADDRESS_1: 'Ward', REGION: 'District', PROVINCE: 'Province' },
          bank: { ID: 30, RQ_BANK_NAME: 'Bank', RQ_ACC_NUM: '123' },
        },
      ),
    ).toEqual({
      id: '7',
      name: 'A',
      phone: '123',
      email: 'a@example.com',
      website: 'https://a.test',
      address: { ward: 'Ward', district: 'District', province: 'Province' },
      bank: { bankName: 'Bank', accountNumber: '123' },
    });
  });

  it('should join first and last name of contacts created in Bitrix24', () => {
    expect(fromBitrixItem({ id: 1, name: 'Van A', lastName: 'Nguyen' }).name).toBe('Van A Nguyen');
  });

  it('should preserve remote multifield IDs when preparing updates', () => {
    expect(
      toUpdateFields(
        { phone: '999', email: 'b@example.com' },
        { id: 1, name: 'A', fm: [{ id: 11, typeId: 'PHONE', valueType: 'WORK', value: '123' }] },
      ),
    ).toEqual({
      fm: {
        11: { typeId: 'PHONE', valueType: 'WORK', value: '999' },
        n0: { typeId: 'EMAIL', valueType: 'WORK', value: 'b@example.com' },
      },
    });
  });

  it('should write the full name to name and clear lastName on rename', () => {
    expect(toUpdateFields({ name: 'B' }, { id: 1, name: 'A', lastName: 'X' })).toEqual({
      name: 'B',
      lastName: '',
    });
  });
});
