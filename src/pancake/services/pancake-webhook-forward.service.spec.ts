import axios from 'axios';
import { PancakeWebhookForwardService } from './pancake-webhook-forward.service';

describe('PancakeWebhookForwardService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('retries the canonical Laravel webhook route when configured URL returns 404', async () => {
    process.env.LARAVEL_WEBHOOK_URL = 'https://crm.example.test/wrong-route';
    delete process.env.VCC_LARAVEL_WEBHOOK_URL;
    delete process.env.MINTOKU_LARAVEL_WEBHOOK_URL;
    const postSpy = jest
      .spyOn(axios, 'post')
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: '404',
        response: { status: 404, data: 'Not Found' },
      })
      .mockResolvedValueOnce({ data: { success: true } });

    const ok = await new PancakeWebhookForwardService().forwardToLaravel({
      event: 'message_received',
    });

    expect(ok).toBe(true);
    expect(postSpy).toHaveBeenNthCalledWith(
      2,
      'https://crm.example.test/api/webhooks/pancake',
      expect.any(Object),
      expect.any(Object),
    );
  });
});
