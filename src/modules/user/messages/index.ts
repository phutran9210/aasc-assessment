import { createModuleMessages } from '@common/messages/index.js';

import { USER_CONSTRAINTS } from '../constants/index.js';

const { USERNAME, PASSWORD, NICKNAME, EMAIL } = USER_CONSTRAINTS;

export const USER_MESSAGES = createModuleMessages({
  entityName: 'Người dùng',
  entityNamePlural: 'người dùng',
  customSuccess: {
    PROFILE_UPDATED: 'Cập nhật thông tin thành công',
  },
  customError: {
    USERNAME_TAKEN: 'Tên đăng nhập đã tồn tại',
    EMAIL_TAKEN: 'Email đã được sử dụng',
    USERNAME_INVALID: `username phải dài ${USERNAME.MIN_LENGTH}-${USERNAME.MAX_LENGTH} ký tự và chỉ gồm chữ, số, dấu gạch dưới`,
    PASSWORD_TOO_SHORT: `password phải có ít nhất ${PASSWORD.MIN_LENGTH} ký tự`,
    PASSWORD_TOO_LONG: `password không được vượt quá ${PASSWORD.MAX_BYTES} byte`,
    PASSWORD_NOT_STRING: 'password phải là chuỗi',
    EMAIL_INVALID: 'Email không hợp lệ',
    EMAIL_TOO_LONG: `email không được vượt quá ${EMAIL.MAX_LENGTH} ký tự`,
    NICKNAME_INVALID: `nickname phải dài ${NICKNAME.MIN_LENGTH}-${NICKNAME.MAX_LENGTH} ký tự`,
  },
});
