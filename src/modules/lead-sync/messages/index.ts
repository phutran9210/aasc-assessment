export const LEAD_SYNC_MESSAGES = {
  ERROR: {
    BITRIX_NOT_CONNECTED:
      'Chưa kết nối Bitrix24: đặt BITRIX24_WEBHOOK_URL hoặc cài ứng dụng qua /install',
    BITRIX_PLAN_BLOCKED: (code: string): string =>
      `Gói dịch vụ của portal Bitrix24 không cho dùng REST API (${code}): bật dùng thử hoặc nâng gói của portal rồi chạy lại`,
    TWO_WAY_OFF:
      'Đồng bộ hai chiều đang tắt: đặt LEAD_SYNC_DIRECTION=two-way để ghi thay đổi từ Bitrix24 về Sheet',
    PUBLIC_URL_MISSING:
      'Chưa cấu hình APP_PUBLIC_URL: Bitrix24 cần một địa chỉ công khai (ví dụ URL ngrok) để gửi sự kiện',
    EVENT_TOKEN_INVALID: 'Sự kiện Bitrix24 có application_token không hợp lệ',
    SIMPLE_CRM_MODE:
      'Bitrix24 đang ở chế độ CRM đơn giản (không dùng Lead): lead mới sẽ bị tự chuyển thành Deal và Contact. Chuyển sang CRM cổ điển trong CRM > Cài đặt > Chế độ CRM rồi chạy lại',
    BUSY: (runId: string | null): string =>
      `Đang có một lần đồng bộ khác chạy${runId ? `: ${runId}` : ''}`,
    RUN_NOT_FOUND: 'Không tìm thấy lần chạy',
    MAPPING_FILE: (path: string): string => `Không đọc được file mapping ${path}`,
    MAPPING_WRITE: (path: string): string =>
      `Không ghi được file mapping ${path}; kiểm tra quyền ghi (trong Docker thư mục config được mount chỉ đọc)`,
    MAPPING_JSON: (path: string): string => `File mapping ${path} không phải JSON hợp lệ`,
    MAPPING_INVALID: (problems: string[]): string => `Mapping không hợp lệ: ${problems.join('; ')}`,
    HEADER_ROW_EMPTY: (row: number): string =>
      `Hàng tiêu đề (hàng ${row}) đang trống; kiểm tra sheet.headerRow trong mapping`,
    STOPPED_BY_SIGNAL: 'Dừng theo yêu cầu tắt tiến trình; các hàng còn lại chờ lần chạy sau',
    TIME_LIMIT: 'Bitrix24 báo OPERATION_TIME_LIMIT; các hàng còn lại chờ lần chạy sau',
    STALE: 'Lần chạy không còn phản hồi và đã bị lần chạy sau tiếp quản',
  },
  MAPPING: {
    DUPLICATE_COLUMN: (column: string): string => `cột "${column}" được khai báo hai lần`,
    DUPLICATE_FIELD: (field: string): string => `trường "${field}" được khai báo hai lần`,
    TECHNICAL_COLUMN: (column: string): string =>
      `cột "${column}" do ứng dụng quản lý, không được đưa vào mapping`,
    ENUM_VALUES: (column: string): string => `cột "${column}" kiểu enum phải có bảng values`,
    DEDUPE_KEY_UNMAPPED: (key: string): string =>
      `dedupe.keys có "${key}" nhưng không cột nào ánh xạ vào trường "${key}"`,
    COLUMN_MISSING: (column: string): string => `Sheet không có cột "${column}"`,
    FIELD_UNKNOWN: (field: string): string => `Bitrix24 không có trường lead "${field}"`,
  },
  VALIDATION: {
    COLUMN: (column: string, reason: string): string => `Cột "${column}": ${reason}`,
    REQUIRED: 'không được để trống',
    ONE_OF_MANY: (value: string, reason: string): string => `"${value}": ${reason}`,
    FORMULA_ERROR: (value: string): string => `công thức đang lỗi (${value})`,
    EMAIL: 'email sai định dạng, ví dụ đúng: ten@congty.vn',
    PHONE: 'số điện thoại chỉ gồm chữ số, có thể bắt đầu bằng + hoặc 0, dài 8 đến 15 chữ số',
    DATE: 'ngày không hợp lệ, ví dụ đúng: 08/10/2026 hoặc 2026-10-08',
    NUMBER: 'phải là số không âm, ví dụ 1500000, 1.500.000 hoặc 15tr',
    ENUM: (label: string, allowed: string[]): string =>
      `giá trị "${label}" không hợp lệ; chọn một trong: ${allowed.join(', ')}`,
    DEDUPE_KEY_REQUIRED: 'Cần ít nhất Email hoặc Số điện thoại để chống trùng',
  },
  ROW: {
    DUPLICATE_ROW: (rowNumber: number): string =>
      `Trùng với hàng ${rowNumber}: đổi email hoặc số điện thoại rồi xóa ô Lead ID để tạo lead mới`,
    LEAD_ID_INVALID: 'Ô Lead ID Bitrix24 không phải số nguyên dương; xóa nội dung ô để đồng bộ lại',
    LEAD_DELETED: 'Lead không còn tồn tại trong Bitrix24; xóa nội dung ô Lead ID nếu muốn tạo lại',
    LEAD_UNREADABLE: 'Tìm thấy lead trùng nhưng chưa đọc được; hàng sẽ được thử lại ở lần chạy sau',
    ROW_MOVED: 'Hàng bị di chuyển trong lúc đồng bộ; kết quả sẽ được ghi ở lần chạy sau',
    TRANSIENT: (reason: string): string => `Lỗi tạm thời, sẽ thử lại ở lần chạy sau: ${reason}`,
    REJECTED: (reason: string): string => `Bitrix24 từ chối dữ liệu: ${reason}`,
  },
} as const;
