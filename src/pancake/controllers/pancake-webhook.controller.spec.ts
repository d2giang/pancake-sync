import { Logger } from '@nestjs/common';
import { PancakeWebhookController } from './pancake-webhook.controller';
import { PancakeWebhookForwardService } from '../services/pancake-webhook-forward.service';
import { LocalCacheService } from '../services/local-cache.service';
import { RealtimeService } from '../../realtime/realtime.service';

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

function makeResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as MockResponse;
}

function makeMessagingBody(overrides: Record<string, any> = {}) {
  return {
    event_type: 'messaging',
    page_id: 'page-1',
    data: {
      conversation: {
        conversation_id: 'conv-1',
        page_id: 'page-1',
      },
      message: {
        message_id: 'msg-1',
        conversation_id: 'conv-1',
        from: { id: 'user-1', name: 'Test User' },
        message: 'hello',
      },
      post: null,
    },
    ...overrides,
  };
}

describe('PancakeWebhookController', () => {
  let controller: PancakeWebhookController;
  let forwardService: jest.Mocked<PancakeWebhookForwardService>;
  let cache: jest.Mocked<LocalCacheService>;
  let realtimeService: jest.Mocked<RealtimeService>;
  let originalEnv: NodeJS.ProcessEnv;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.PANCAKE_MESSAGING_WEBHOOK_ENABLED;
    delete process.env.FORWARD_MESSAGING_EVENTS;
    delete process.env.STORE_CONVERSATION_CACHE;
    delete process.env.STORE_MESSAGE_CACHE;

    forwardService = {
      forwardToLaravel: jest.fn(),
      forwardToLegacyLaravel: jest.fn(),
    } as any;

    cache = {
      upsertConversation: jest.fn(),
      appendMessage: jest.fn(),
    } as any;

    realtimeService = {
      emitMessageCreated: jest.fn(),
      emitConversationUpdated: jest.fn(),
    } as any;

    controller = new PancakeWebhookController(
      forwardService,
      cache,
      realtimeService,
    );

    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('responds 200 for a valid messaging webhook before Laravel forwarding resolves', async () => {
    // Laravel forward never resolves during this test — proves the HTTP
    // response does not wait on it.
    forwardService.forwardToLaravel.mockReturnValue(new Promise(() => {}));

    const req: any = { body: makeMessagingBody() };
    const res = makeResponse();

    await controller.handlePost(req, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'EVENT_RECEIVED' }),
    );
    expect(forwardService.forwardToLaravel).toHaveBeenCalled();
  });

  it('does not turn a Laravel error/timeout into a 500 response', async () => {
    forwardService.forwardToLaravel.mockRejectedValue(
      new Error('Laravel timeout'),
    );

    const req: any = { body: makeMessagingBody() };
    const res = makeResponse();

    const bgSpy = jest.spyOn(controller as any, 'processMessagingWebhook');

    await controller.handlePost(req, res as any);

    // Let the background job run to completion.
    await bgSpy.mock.results[0].value;

    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'EVENT_RECEIVED' }),
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it('responds 200 quickly for non-messaging events, relaying to legacy Laravel in the background', async () => {
    forwardService.forwardToLegacyLaravel.mockReturnValue(
      new Promise(() => {}),
    );

    const req: any = {
      body: { event_type: 'comment', page_id: 'page-1', foo: 'bar' },
    };
    const res = makeResponse();

    await controller.handlePost(req, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'OK' }),
    );
    expect(forwardService.forwardToLegacyLaravel).toHaveBeenCalledWith(
      req.body,
    );
  });

  it('rejects a non-object payload with 400', async () => {
    const req: any = { body: null };
    const res = makeResponse();

    await controller.handlePost(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(forwardService.forwardToLaravel).not.toHaveBeenCalled();
    expect(forwardService.forwardToLegacyLaravel).not.toHaveBeenCalled();
  });

  it('responds 200 OK for a messaging event missing conversation/message without doing background work', async () => {
    const req: any = {
      body: { event_type: 'messaging', page_id: 'page-1', data: {} },
    };
    const res = makeResponse();

    await controller.handlePost(req, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'OK' }),
    );
    expect(forwardService.forwardToLaravel).not.toHaveBeenCalled();
  });

  it('catches a synchronous error thrown during background processing and logs it, without an unhandled rejection', async () => {
    cache.upsertConversation.mockImplementation(() => {
      throw new Error('disk full');
    });

    const req: any = { body: makeMessagingBody() };
    const res = makeResponse();

    const bgSpy = jest.spyOn(controller as any, 'processMessagingWebhook');

    await controller.handlePost(req, res as any);

    // The background promise must resolve (not reject) even though the
    // cache write threw synchronously inside it.
    await expect(bgSpy.mock.results[0].value).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    // Forwarding to Laravel still happens even though the cache write failed.
    expect(forwardService.forwardToLaravel).toHaveBeenCalled();
  });

  it('logs total background processing duration', async () => {
    forwardService.forwardToLaravel.mockResolvedValue(true);

    const req: any = { body: makeMessagingBody() };
    const res = makeResponse();

    const bgSpy = jest.spyOn(controller as any, 'processMessagingWebhook');

    await controller.handlePost(req, res as any);
    await bgSpy.mock.results[0].value;

    const durationLog = logSpy.mock.calls.find((call) =>
      String(call[0]).includes(
        'Background messaging webhook processing finished in',
      ),
    );
    expect(durationLog).toBeTruthy();
  });

  it('only emits realtime events after both conversation and message forwards succeed', async () => {
    forwardService.forwardToLaravel
      .mockResolvedValueOnce(true) // conversation save
      .mockResolvedValueOnce(false); // message save fails

    const req: any = { body: makeMessagingBody() };
    const res = makeResponse();

    const bgSpy = jest.spyOn(controller as any, 'processMessagingWebhook');

    await controller.handlePost(req, res as any);
    await bgSpy.mock.results[0].value;

    expect(realtimeService.emitMessageCreated).not.toHaveBeenCalled();
    expect(realtimeService.emitConversationUpdated).not.toHaveBeenCalled();
  });

  it('emits the message contract with Pancake IDs after both Laravel saves succeed', async () => {
    forwardService.forwardToLaravel.mockResolvedValue(true);
    const req: any = { body: makeMessagingBody() };
    const res = makeResponse();
    const bgSpy = jest.spyOn(controller as any, 'processMessagingWebhook');

    await controller.handlePost(req, res as any);
    await bgSpy.mock.results[0].value;

    expect(forwardService.forwardToLaravel).toHaveBeenCalledTimes(2);
    expect(realtimeService.emitMessageCreated).toHaveBeenCalledWith({
      page_id: 'page-1',
      conversation_id: 'conv-1',
      message_id: 'msg-1',
      timestamp: expect.any(String),
      source: 'pancake',
    });
    expect(realtimeService.emitConversationUpdated).toHaveBeenCalledWith({
      page_id: 'page-1',
      conversation_id: 'conv-1',
      timestamp: expect.any(String),
      source: 'pancake',
    });
  });

  it('sends a stable idempotency key for the message forward call', async () => {
    forwardService.forwardToLaravel.mockResolvedValue(true);

    const req: any = { body: makeMessagingBody() };
    const res = makeResponse();

    const bgSpy = jest.spyOn(controller as any, 'processMessagingWebhook');

    await controller.handlePost(req, res as any);
    await bgSpy.mock.results[0].value;

    const messageCall = forwardService.forwardToLaravel.mock.calls.find(
      (call) => call[0].event === 'message_received',
    );

    expect(messageCall?.[0].idempotency_key).toEqual(expect.any(String));
    expect(messageCall?.[0].idempotency_key.length).toBeGreaterThan(0);
  });
});
