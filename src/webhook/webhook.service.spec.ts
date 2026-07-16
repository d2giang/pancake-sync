import axios from 'axios';
import { WebhookService } from './webhook.service';

jest.mock('axios');

describe('WebhookService pending referral delivery', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.VCC_LARAVEL_API_BASE_URL = 'https://crm.vccdev.vn/api';
    process.env.VCC_LARAVEL_WEBHOOK_SECRET = 'vcc-secret';
    process.env.MINTOKU_LARAVEL_API_BASE_URL = 'https://crm.mintoku.vn/api';
    process.env.MINTOKU_LARAVEL_WEBHOOK_SECRET = 'mintoku-secret';
    delete process.env.LARAVEL_API_BASE_URL;
    delete process.env.LARAVEL_WEBHOOK_SECRET;
    mockedAxios.post.mockResolvedValue({ data: { success: true } } as any);
    mockedAxios.delete.mockResolvedValue({ data: { success: true } } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('stores a captured ref in every configured Laravel CRM', async () => {
    const service = new WebhookService();

    await service.setPendingRef('331141913426390_customer-1', {
      ref: 'xxxxx',
      page_id: '331141913426390',
      sender_id: 'customer-1',
      captured_at: '2026-07-16T00:00:00.000Z',
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://crm.vccdev.vn/api/internal/pancake/pending-refs',
      expect.objectContaining({ ref: 'xxxxx' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Webhook-Secret': 'vcc-secret',
        }),
      }),
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://crm.mintoku.vn/api/internal/pancake/pending-refs',
      expect.objectContaining({ ref: 'xxxxx' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Webhook-Secret': 'mintoku-secret',
        }),
      }),
    );
  });

  it('keeps the ref available after Pancake CRM succeeds', async () => {
    const service = new WebhookService();
    jest.spyOn(service, 'syncRefToPancake').mockResolvedValue(true);
    const removeSpy = jest.spyOn(service, 'removePendingRef');

    await service.handleRefCapture('331141913426390', 'customer-1', 'xxxxx');

    expect(removeSpy).not.toHaveBeenCalled();
  });
});
