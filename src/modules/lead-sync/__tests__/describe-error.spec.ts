import { BitrixHttpError } from '@modules/bitrix/index.js';

import { describeError } from '../errors/describe-error.js';

describe('describeError', () => {
  it('should tell the admin what to check when Bitrix24 refuses the credentials', () => {
    expect(
      describeError(new BitrixHttpError('Invalid request credentials', 'INVALID_CREDENTIALS', 401)),
    ).toBe(
      'Bitrix24 từ chối thông tin xác thực (INVALID_CREDENTIALS): kiểm tra BITRIX24_WEBHOOK_URL, hoặc cài lại ứng dụng nếu dùng OAuth',
    );
  });

  it('should explain a portal whose plan blocks the REST API', () => {
    expect(
      describeError(
        new BitrixHttpError(
          'Feature is not available.',
          'FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN',
          403,
        ),
      ),
    ).toMatch(/^Gói dịch vụ của portal Bitrix24 không cho dùng REST API/);
  });

  it('should keep the Bitrix24 message and code for other errors', () => {
    expect(describeError(new BitrixHttpError('Access denied', 'ACCESS_DENIED', 403))).toBe(
      'Access denied (ACCESS_DENIED)',
    );
    expect(describeError(new Error('Google từ chối truy cập'))).toBe('Google từ chối truy cập');
    expect(describeError('lạ')).toBe('lạ');
  });
});
