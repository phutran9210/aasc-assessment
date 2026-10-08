import type { BitrixApiService } from '@modules/bitrix/index.js';
import type { GoogleAuthProvider } from '@modules/google-sheets/index.js';

import { LeadSyncReadiness } from '../services/lead-sync-readiness.service.js';

describe('LeadSyncReadiness', () => {
  const google = { missingConfig: jest.fn() };
  const bitrix = { isConfigured: jest.fn() };
  const readiness = new LeadSyncReadiness(
    google as unknown as GoogleAuthProvider,
    bitrix as unknown as BitrixApiService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('should report the Google problem first', async () => {
    google.missingConfig.mockReturnValue('Chưa cấu hình GOOGLE_SHEET_ID');

    await expect(readiness.missing()).resolves.toBe('Chưa cấu hình GOOGLE_SHEET_ID');
    expect(bitrix.isConfigured).not.toHaveBeenCalled();
  });

  it('should report a missing Bitrix24 connection', async () => {
    google.missingConfig.mockReturnValue(null);
    bitrix.isConfigured.mockResolvedValue(false);

    await expect(readiness.missing()).resolves.toBe(
      'Chưa kết nối Bitrix24: đặt BITRIX24_WEBHOOK_URL hoặc cài ứng dụng qua /install',
    );
  });

  it('should report nothing when both sides are configured', async () => {
    google.missingConfig.mockReturnValue(null);
    bitrix.isConfigured.mockResolvedValue(true);

    await expect(readiness.missing()).resolves.toBeNull();
  });
});
