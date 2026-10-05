import { createModuleMessages } from '../index.js';

describe('createModuleMessages', () => {
  it('should generate base messages when only entity names are given', () => {
    const messages = createModuleMessages({ entityName: 'Contact', entityNamePlural: 'Contacts' });

    expect(messages.SUCCESS).toEqual({
      CREATED: 'Tạo Contact thành công',
      UPDATED: 'Cập nhật Contact thành công',
      DELETED: 'Xóa Contact thành công',
      FETCHED: 'Lấy thông tin Contact thành công',
      LISTED: 'Lấy danh sách Contacts thành công',
    });
    expect(messages.ERROR).toEqual({
      NOT_FOUND: 'Contact không tồn tại',
      ALREADY_EXISTS: 'Contact đã tồn tại',
    });
    expect(messages.WARNING).toEqual({});
  });

  it('should expose custom messages next to base ones when custom maps are given', () => {
    const messages = createModuleMessages({
      entityName: 'Contact',
      entityNamePlural: 'Contacts',
      customSuccess: { SYNCED: 'Đồng bộ Contact thành công' },
      customError: { INVALID_EMAIL: 'Email không hợp lệ' },
      customWarning: { NO_BANK: 'Contact chưa có thông tin ngân hàng' },
    });

    expect(messages.SUCCESS.SYNCED).toBe('Đồng bộ Contact thành công');
    expect(messages.SUCCESS.CREATED).toBe('Tạo Contact thành công');
    expect(messages.ERROR.INVALID_EMAIL).toBe('Email không hợp lệ');
    expect(messages.WARNING.NO_BANK).toBe('Contact chưa có thông tin ngân hàng');
  });

  it('should let a custom message override the base one when keys collide', () => {
    const messages = createModuleMessages({
      entityName: 'Task',
      entityNamePlural: 'Tasks',
      customError: { NOT_FOUND: 'Không tìm thấy task' },
    });

    expect(messages.ERROR.NOT_FOUND).toBe('Không tìm thấy task');
  });
});
