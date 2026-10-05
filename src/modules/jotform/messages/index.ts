export const JOTFORM_MESSAGES = {
  ERROR: {
    CONFIG: 'Tích hợp Jotform chưa được cấu hình',
    SECRET_INVALID: 'Webhook secret không hợp lệ',
    SUBMISSION_ID_REQUIRED: 'Thiếu submissionID',
    SUBMISSION_ID_INVALID: 'submissionID không hợp lệ',
    FORM_MISMATCH: 'Submission không thuộc biểu mẫu đã cấu hình',
    SUBMISSION_NOT_FOUND: 'Không tìm thấy submission trên Jotform',
    // Jotform answers 401 both for a bad key and for a submission the account cannot see.
    AUTH: 'Jotform từ chối truy cập: API Key sai, hoặc submission không tồn tại trong tài khoản',
    TIMEOUT: 'Jotform không phản hồi kịp',
    UPSTREAM: 'Không lấy được dữ liệu từ Jotform',
    ID_INVALID: 'Jotform id không hợp lệ',
    API_KEY_MISSING: 'JOTFORM_API_KEY chưa được cấu hình',
    REQUEST_TIMEOUT: 'Jotform request timeout',
    UNREACHABLE: 'Không thể kết nối Jotform',
    RESPONSE_INVALID: 'Jotform trả về dữ liệu không hợp lệ',
  },
  VALIDATION: {
    NAME: 'Họ và tên trống hoặc dài quá 255 ký tự',
    PHONE: 'Số điện thoại không hợp lệ',
    EMAIL: 'Email không hợp lệ',
  },
};
