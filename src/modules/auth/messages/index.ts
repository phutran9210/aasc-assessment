export const AUTH_MESSAGES = {
  SUCCESS: {
    REGISTERED: 'Đăng ký thành công',
    LOGGED_IN: 'Đăng nhập thành công',
  },
  ERROR: {
    // One message for "no such user" and "wrong password": does not reveal which usernames exist.
    INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không đúng',
    TOKEN_MISSING: 'Bạn cần đăng nhập để thực hiện thao tác này',
    TOKEN_INVALID: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn',
  },
} as const;
