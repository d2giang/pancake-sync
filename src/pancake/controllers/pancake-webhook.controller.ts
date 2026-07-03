import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PancakeWebhookForwardService } from '../services/pancake-webhook-forward.service';
import { LocalCacheService } from '../services/local-cache.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { mapConversationToSummary } from '../mappers/pancake-conversation.mapper';
import { mapMessageToNormalized } from '../mappers/pancake-message.mapper';
import {
  buildLaravelConversationFields,
  buildLaravelMessageFields,
} from '../mappers/laravel-payload.mapper';
import {
  PancakeConversation,
  PancakeMessage,
} from '../interfaces/pancake.interface';
import {
  isMessagingWebhookEnabled,
  isForwardMessagingEvents,
  isStoreConversationCache,
  isStoreMessageCache,
} from '../utils/env-validator';

/**
 * Shape of the work handed off to background processing. Deliberately a
 * plain, serializable object (no class instances, no closures) — this is
 * the same shape a future BullMQ job payload would take, so swapping the
 * in-process `void promise.catch(...)` dispatch below for `queue.add(...)`
 * is a small, mechanical change rather than a rewrite.
 */
interface MessagingWebhookJob {
  pageId: string;
  conversationId: string;
  messageId: string;
  conversation: PancakeConversation;
  message: PancakeMessage;
  receivedAt: string;
}

@Controller('api/pancake/webhook')
export class PancakeWebhookController {
  private readonly logger = new Logger(PancakeWebhookController.name);

  constructor(
    private readonly forwardService: PancakeWebhookForwardService,
    private readonly cache: LocalCacheService,
    private readonly realtimeService: RealtimeService,
  ) {}

  /**
   * POST /api/pancake/webhook
   * Receives Pancake messaging webhooks.
   *
   * Responds 200 as soon as the payload has been validated and logged —
   * everything else (mapping, local cache writes, forwarding to Laravel,
   * realtime emit) runs afterward in `processMessagingWebhook` /
   * `relayNonMessagingEvent`, fired without awaiting them. Pancake suspends
   * a webhook URL after too many slow/failed responses, and previously this
   * handler awaited up to 2 sequential Laravel calls (each with retries)
   * before responding, so concurrent deliveries from multiple pages could
   * queue up behind Laravel latency and trip that suspension.
   *
   * HOTFIX LIMITATION: background work here is a fire-and-forget in-process
   * promise, not a durable queue. If the Node process restarts or crashes
   * while a job is still running, that job's Laravel forward / cache write /
   * realtime emit is lost — Pancake will not receive a retry because we
   * already returned 200. A second pass will move `MessagingWebhookJob` onto
   * BullMQ + Redis so jobs survive restarts; this hotfix only buys back
   * response latency.
   */
  @Post()
  handlePost(@Req() req: Request & { rawBody?: string }, @Res() res: Response) {
    const receivedAt = new Date().toISOString();

    // Feature toggle check
    if (!isMessagingWebhookEnabled()) {
      return res
        .status(200)
        .json({ success: true, message: 'Webhook disabled' });
    }

    // Cast loosely: non-messaging events don't conform to
    // PancakeMessagingWebhookPayload, but we still need to read
    // event_type/page_id off them to decide which branch to take.
    const data = req.body as Record<string, any>;

    if (!data || typeof data !== 'object') {
      this.logger.warn('Invalid Pancake webhook payload');
      return res.status(400).json({ success: false, message: 'Bad Request' });
    }

    const eventType = String(data.event_type || '');
    const pageId = String(data.page_id || '');
    const innerData = data.data as
      | { conversation?: PancakeConversation; message?: PancakeMessage }
      | undefined;
    const conversation = innerData?.conversation;
    const message = innerData?.message;
    const conversationId = String(
      conversation?.conversation_id || conversation?.id || '',
    );
    const messageId = String(message?.message_id || message?.id || '');

    // Log arrival immediately, before any processing/forwarding happens.
    this.logger.log(
      `Pancake webhook received event_type=${eventType || '(none)'} page_id=${pageId || '(none)'} ` +
        `conversation_id=${conversationId || '(none)'} message_id=${messageId || '(none)'} received_at=${receivedAt}`,
    );

    // Any event this service doesn't specifically normalize gets relayed
    // as-is to Laravel's legacy /api/webhook endpoint, preserving current
    // behavior there (e.g. comment events, other Pancake native events)
    // now that Pancake's webhook URL points here instead of directly at
    // Laravel.
    if (eventType !== 'messaging') {
      res.status(200).json({ success: true, message: 'OK' });

      void this.relayNonMessagingEvent(data).catch((error: any) => {
        this.logger.error(
          `Unhandled error relaying non-messaging event: ${error?.message}`,
          error?.stack,
        );
      });

      return;
    }

    if (!pageId || !conversation || !message) {
      this.logger.warn('Missing required fields in messaging webhook');
      return res.status(200).json({ success: true, message: 'OK' });
    }

    // Respond immediately — do not wait on Laravel, cache writes, or
    // realtime emits. Everything below is best-effort background work.
    res.status(200).json({ success: true, message: 'EVENT_RECEIVED' });

    void this.processMessagingWebhook({
      pageId,
      conversationId,
      messageId,
      conversation,
      message,
      receivedAt,
    }).catch((error: any) => {
      this.logger.error(
        `Unhandled error processing messaging webhook: ${error?.message}`,
        error?.stack,
      );
    });
  }

  /**
   * Background handler for a single messaging webhook event. Runs after the
   * HTTP response has already been sent. Every failure is caught and logged
   * here — nothing in this method should ever surface as an unhandled
   * rejection to its caller.
   */
  private async processMessagingWebhook(
    job: MessagingWebhookJob,
  ): Promise<void> {
    const startedAt = Date.now();
    const { pageId, conversationId, conversation, message, receivedAt } = job;

    try {
      // 1. Normalize conversation
      const summary = mapConversationToSummary(conversation);

      // 2. Normalize message
      const normalizedMessage = mapMessageToNormalized(message, pageId);

      // 3. Cache locally (respect store flags — skipped entirely, not just
      // deferred, when disabled so production can turn off local JSON
      // writes without touching this code path). Isolated in its own
      // try/catch: the local cache is best-effort and must never prevent
      // the Laravel forward below, which is the critical path.
      try {
        if (isStoreConversationCache()) {
          this.cache.upsertConversation(summary);
        }
        if (isStoreMessageCache()) {
          this.cache.appendMessage({
            conversation_id: conversationId,
            normalized_message: normalizedMessage,
            raw_message: message,
          });
        }
      } catch (cacheError: any) {
        this.logger.error(
          `Local cache write failed for conversation_id=${conversationId}: ${cacheError?.message}`,
          cacheError?.stack,
        );
      }

      // 4. Forward to Laravel (respect forward flag)
      if (isForwardMessagingEvents()) {
        const occurredAt = new Date().toISOString();

        // 4a. Ensure the candidate exists/is matched. Conversation is saved
        // before the message below, since Laravel's message insert depends
        // on the candidate/conversation row already existing.
        // Timed individually (not just the overall job duration) so a slow
        // Laravel round-trip — vs. a slow NestJS cold start, vs. a slow FE
        // socket — can be told apart from the logs alone.
        const convStartedAt = Date.now();
        const convOk = await this.forwardService.forwardToLaravel({
          event_version: '1.0',
          event: 'pancake_messaging',
          action: 'conversation_message_received',
          occurred_at: occurredAt,
          page_id: pageId,
          conversation_id: conversationId,
          ...buildLaravelConversationFields(summary),
        });
        const convDurationMs = Date.now() - convStartedAt;

        // 4b. Persist the actual message. buildLaravelMessageFields attaches
        // a stable idempotency_key (hash of page/conversation/message id)
        // so Laravel can dedupe if this webhook is ever delivered twice.
        const msgStartedAt = Date.now();
        const msgOk = await this.forwardService.forwardToLaravel({
          event_version: '1.0',
          event: 'message_received',
          action: 'conversation_message_received',
          occurred_at: occurredAt,
          page_id: pageId,
          conversation_id: conversationId,
          ...buildLaravelMessageFields(
            pageId,
            conversationId,
            normalizedMessage,
          ),
        });
        const msgDurationMs = Date.now() - msgStartedAt;

        this.logger.log(
          `Laravel forward timing conversation_id=${conversationId}: ` +
            `conversation_save=${convDurationMs}ms(ok=${convOk}) message_save=${msgDurationMs}ms(ok=${msgOk})`,
        );

        // 5. Emit realtime only after Laravel confirms both saves.
        if (convOk && msgOk) {
          const emitStartedAt = Date.now();
          const messageId = String(normalizedMessage?.message_id || '');
          this.realtimeService.emitMessageCreated({
            page_id: pageId,
            conversation_id: conversationId,
            message_id: messageId || undefined,
            timestamp: occurredAt,
            source: 'pancake',
          });
          this.realtimeService.emitConversationUpdated({
            page_id: pageId,
            conversation_id: conversationId,
            timestamp: occurredAt,
            source: 'pancake',
          });
          this.logger.log(
            `Realtime emitted conversation_id=${conversationId} at=${new Date().toISOString()} ` +
              `emit_call_took=${Date.now() - emitStartedAt}ms`,
          );
        } else {
          this.logger.warn(
            `Laravel forward incomplete for conversation_id=${conversationId}: ` +
              `conversation_saved=${convOk} message_saved=${msgOk} — realtime emit skipped`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Background messaging webhook processing failed for conversation_id=${conversationId}: ${error?.message}`,
        error?.stack,
      );
    } finally {
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Background messaging webhook processing finished in ${durationMs}ms ` +
          `conversation_id=${conversationId} received_at=${receivedAt}`,
      );
    }
  }

  /**
   * Background relay of a raw, unmodified non-messaging Pancake webhook
   * payload to Laravel's legacy endpoint. Runs after the HTTP response has
   * already been sent; all failures are caught and logged here.
   */
  private async relayNonMessagingEvent(
    data: Record<string, any>,
  ): Promise<void> {
    const startedAt = Date.now();

    try {
      await this.forwardService.forwardToLegacyLaravel(data);
    } catch (error: any) {
      this.logger.error(
        `Background legacy relay failed: ${error?.message}`,
        error?.stack,
      );
    } finally {
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Background legacy relay finished in ${durationMs}ms event_type=${String(data.event_type || data.event || '(none)')}`,
      );
    }
  }
}
