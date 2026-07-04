import { Logger } from '@nestjs/common';
import { WebhookController } from './webhook.controller';

function response() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.type = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function messagingBody() {
  return {
    event_type: 'messaging',
    page_id: '331141913426390',
    data: {
      conversation: {
        conversation_id: '331141913426390_thread-1',
        page_id: '331141913426390',
      },
      message: {
        message_id: 'message-1',
        conversation_id: '331141913426390_thread-1',
        from: { id: 'customer-1', name: 'Customer' },
        message: 'hello',
      },
    },
  };
}

describe('WebhookController legacy Pancake messaging compatibility', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('saves through Laravel and emits realtime when messaging arrives on /api/webhook', async () => {
    delete process.env.PANCAKE_MESSAGING_WEBHOOK_ENABLED;
    delete process.env.FORWARD_MESSAGING_EVENTS;
    delete process.env.STORE_CONVERSATION_CACHE;
    delete process.env.STORE_MESSAGE_CACHE;
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const service: any = { logLine: jest.fn() };
    const forwardService: any = {
      forwardToLaravel: jest.fn().mockResolvedValue(true),
    };
    const cache: any = {
      upsertConversation: jest.fn(),
      appendMessage: jest.fn(),
    };
    const realtimeService: any = {
      emitMessageCreated: jest.fn(),
      emitConversationUpdated: jest.fn(),
    };
    const controller = new WebhookController(
      service,
      forwardService,
      cache,
      realtimeService,
    );
    const res = response();

    await controller.handlePost(
      { body: messagingBody(), header: jest.fn() } as any,
      res,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(forwardService.forwardToLaravel).toHaveBeenCalledTimes(2);
    expect(realtimeService.emitMessageCreated).toHaveBeenCalledWith({
      page_id: '331141913426390',
      conversation_id: '331141913426390_thread-1',
      message_id: 'message-1',
      timestamp: expect.any(String),
      source: 'pancake',
    });
  });

  it('does not emit when either Laravel save fails', async () => {
    const service: any = { logLine: jest.fn() };
    const forwardService: any = {
      forwardToLaravel: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const realtimeService: any = {
      emitMessageCreated: jest.fn(),
      emitConversationUpdated: jest.fn(),
    };
    const controller = new WebhookController(
      service,
      forwardService,
      { upsertConversation: jest.fn(), appendMessage: jest.fn() } as any,
      realtimeService,
    );

    await controller.handlePost(
      { body: messagingBody(), header: jest.fn() } as any,
      response(),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(realtimeService.emitMessageCreated).not.toHaveBeenCalled();
  });

  it('relays non-messaging Pancake events to Laravel legacy after responding', async () => {
    const service: any = {
      logLine: jest.fn(),
      cleanOldPendingRefs: jest.fn().mockResolvedValue(undefined),
      isPancakePayload: jest.fn().mockReturnValue(false),
      isPancakeCreatedRecord: jest.fn().mockReturnValue(false),
      isPancakeUpdatedRecord: jest.fn().mockReturnValue(false),
    };
    const forwardService: any = {
      forwardToLegacyLaravel: jest.fn().mockResolvedValue(true),
    };
    const controller = new WebhookController(
      service,
      forwardService,
      {} as any,
      {} as any,
    );
    const res = response();
    const body = { event_type: 'comment', page_id: 'page-1' };

    await controller.handlePost({ body, header: jest.fn() } as any, res);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(forwardService.forwardToLegacyLaravel).toHaveBeenCalledWith(body);
  });
});
