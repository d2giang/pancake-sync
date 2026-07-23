import { TikTokMessagePollingScheduler } from './tiktok-message-polling.scheduler';

describe('TikTokMessagePollingScheduler', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('forwards a polled TikTok message once and emits realtime', async () => {
    process.env.PANCAKE_PAGES = JSON.stringify([
      { id: 'ttm_page', platform: 'tiktok', token: 'token' },
    ]);
    process.env.STORE_CONVERSATION_CACHE = 'false';
    process.env.STORE_MESSAGE_CACHE = 'false';
    process.env.FORWARD_MESSAGING_EVENTS = 'true';

    const api = {
      getConversations: jest.fn().mockResolvedValue({
        conversations: [{ conversation_id: 'conversation-1' }],
      }),
      getConversationMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            message_id: 'message-1',
            from: { id: 'customer-1', name: 'Customer' },
            message: 'Xin chào',
            inserted_at: '2026-07-23T02:00:00Z',
          },
        ],
      }),
    };
    const forwardService = {
      forwardToLaravel: jest.fn().mockResolvedValue(true),
    };
    const realtime = {
      emitMessageCreated: jest.fn(),
      emitConversationUpdated: jest.fn(),
    };
    const scheduler = new TikTokMessagePollingScheduler(
      api as any,
      forwardService as any,
      {} as any,
      realtime as any,
      { record: jest.fn() } as any,
    );

    await scheduler.poll();
    await scheduler.poll();

    expect(forwardService.forwardToLaravel).toHaveBeenCalledTimes(2);
    expect(realtime.emitMessageCreated).toHaveBeenCalledTimes(1);
    expect(realtime.emitMessageCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'ttm_page',
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      }),
    );
  });
});
