export const GOOGLE_SHEETS_MESSAGES = {
  ERROR: {
    SHEET_ID_MISSING: 'Chưa cấu hình GOOGLE_SHEET_ID',
    OAUTH_UNSUPPORTED:
      'GOOGLE_AUTH_MODE=oauth chưa được hỗ trợ ở phiên bản này; dùng service_account',
    KEY_MISSING:
      'Chưa cấu hình khóa service account: đặt GOOGLE_SERVICE_ACCOUNT_KEY_FILE hoặc GOOGLE_SERVICE_ACCOUNT_KEY_BASE64',
    KEY_UNREADABLE: (path: string): string => `Không đọc được file khóa service account ${path}`,
    KEY_INVALID: 'Khóa service account không hợp lệ: thiếu client_email hoặc private_key',
    WORKSHEET_NOT_FOUND: (name: string): string =>
      `Spreadsheet không có worksheet tên "${name}"; kiểm tra GOOGLE_SHEET_NAME`,
    AUTH: 'Google từ chối truy cập: kiểm tra khóa service account và share Sheet quyền Editor cho email của service account',
    NOT_FOUND: 'Không tìm thấy spreadsheet; kiểm tra GOOGLE_SHEET_ID',
    INVALID: 'Google từ chối yêu cầu vì dữ liệu không hợp lệ',
    RATE_LIMIT: 'Google Sheets đang giới hạn tốc độ',
    TIMEOUT: 'Google Sheets không phản hồi kịp',
    NETWORK: 'Không thể kết nối Google Sheets',
    UPSTREAM: 'Google Sheets gặp lỗi máy chủ',
  },
} as const;
