export const GOOGLE_SHEETS_MESSAGES = {
  ERROR: {
    SHEET_ID_MISSING: 'Chưa cấu hình GOOGLE_SHEET_ID',
    OAUTH_CONFIG_MISSING:
      'Chưa cấu hình Google OAuth: đặt GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET và GOOGLE_OAUTH_REDIRECT_URI',
    OAUTH_NOT_AUTHORIZED:
      'Chưa cấp quyền Google: đăng nhập rồi mở GET /google/oauth/authorize và làm theo đường dẫn trả về',
    OAUTH_TOKEN_INVALID:
      'File token Google OAuth không hợp lệ: cấp quyền lại qua GET /google/oauth/authorize',
    OAUTH_STATE_INVALID:
      'Yêu cầu cấp quyền Google không hợp lệ hoặc đã hết hạn; mở lại GET /google/oauth/authorize',
    OAUTH_CODE_REQUIRED: 'Thiếu mã cấp quyền (code) của Google',
    OAUTH_CODE_REJECTED: 'Google từ chối mã cấp quyền; mở lại GET /google/oauth/authorize',
    OAUTH_NO_REFRESH_TOKEN:
      'Google không trả refresh token: gỡ quyền của ứng dụng tại myaccount.google.com/permissions rồi cấp quyền lại',
    OAUTH_TOKEN_UNWRITABLE: (path: string): string =>
      `Không ghi được file token Google OAuth ${path}`,
    OAUTH_MODE_OFF:
      'GOOGLE_AUTH_MODE đang là service_account; đặt GOOGLE_AUTH_MODE=oauth để dùng OAuth',
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
  SUCCESS: {
    OAUTH_AUTHORIZED: 'Đã cấp quyền Google Sheets. Có thể đóng trang này và chạy đồng bộ.',
  },
} as const;
