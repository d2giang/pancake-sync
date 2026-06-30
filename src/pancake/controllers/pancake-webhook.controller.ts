import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PancakeWebhookForwardService } from '../services/pancake-webhook-forward.service';
import { LocalCacheService } from '../services/local-cache.service';
import { mapConversationToSummary } from '../mappers/pancake-conversation.mapper';
import { mapMessageToNormalized } from '../mappers/pancake-message.mapper';
import {
  buildLaravelConversationFields,
  buildLaravelMessageFields,
} from '../mappers/laravel-payload.mapper';
import { PancakeMessagingWebhookPayload } from '../interfaces/pancake.interface';
import {
  isMessagingWebhookEnabled,
  isForwardMessagingEvents,
  isStoreConversationCache,
  isStoreMessageCache,
} from '../utils/env-validator';

@Controller('api/pancake/webhook')
export class PancakeWebhookController {
  private readonly logger = new Logger(PancakeWebhookController.name);

  constructor(
    private readonly forwardService: PancakeWebhookForwardService,
    private readonly cache: LocalCacheService,
  ) {}

  /**
   * POST /api/pancake/webhook
   * Receives Pancake messaging webhooks.
   */
  @Post()
  async handlePost(
    @Req() req: Request & { rawBody?: string },
    @Res() res: Response,
  ) {
    try {
      // Feature toggle check
      if (!isMessagingWebhookEnabled()) {
        return res.status(200).json({ success: true, message: 'Webhook disabled' });
      }

      const data = req.body as PancakeMessagingWebhookPayload;

      if (!data || typeof data !== 'object') {
        this.logger.warn('Invalid Pancake webhook payload');
        return res.status(400).json({ success: false, message: 'Bad Request' });
      }

      const eventType = String(data.event_type || '');

      // Any event this service doesn't specifically normalize gets relayed
      // as-is to Laravel's legacy /api/webhook endpoint, preserving current
      // behavior there (e.g. comment events, other Pancake native events)
      // now that Pancake's webhook URL points here instead of directly at
      // Laravel.
      if (eventType !== 'messaging') {
        this.logger.debug(`Relaying non-messaging event to legacy endpoint: ${eventType || (data as any).event}`);
        await this.forwardService.forwardToLegacyLaravel(data as Record<string, any>);
        return res.status(200).json({ success: true, message: 'OK' });
      }

      const pageId = String(data.page_id || '');
      const conversation = data.data?.conversation;
      const message = data.data?.message;

      if (!pageId || !conversation || !message) {
        this.logger.warn('Missing required fields in messaging webhook');
        return res.status(200).json({ success: true, message: 'OK' });
      }

      const conversationId =
        String(conversation.conversation_id || conversation.id || '');

      // 1. Normalize conversation
      const summary = mapConversationToSummary(conversation);

      // 2. Normalize message
      const normalizedMessage = mapMessageToNormalized(message, pageId);

      // 3. Cache locally (respect store flags)
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

      // 4. Forward to Laravel (respect forward flag)
      if (isForwardMessagingEvents()) {
        const occurredAt = new Date().toISOString();

        // 4a. Ensure the candidate exists/is matched. Laravel's
        // handleMessagingEvent() reads flat fields (facebook_id,
        // customer_name, pancake_customer_id, ...), so the conversation
        // summary must be flattened rather than nested.
        await this.forwardService.forwardToLaravel({
          event_version: '1.0',
          event: 'pancake_messaging',
          action: 'conversation_message_received',
          occurred_at: occurredAt,
          page_id: pageId,
          conversation_id: conversationId,
          ...buildLaravelConversationFields(summary),
        });

        // 4b. Persist the actual message. Laravel only stores message
        // content via the 'message_received' event handler.
        await this.forwardService.forwardToLaravel({
          event_version: '1.0',
          event: 'message_received',
          action: 'conversation_message_received',
          occurred_at: occurredAt,
          page_id: pageId,
          conversation_id: conversationId,
          ...buildLaravelMessageFields(pageId, conversationId, normalizedMessage),
        });
      }

      // Success handled silently — errors go to catch block

      return res.status(200).json({ success: true, message: 'EVENT_RECEIVED' });
    } catch (error: any) {
      this.logger.error(
        `Pancake webhook error: ${error.message}`,
        error.stack,
      );
      return res
        .status(500)
        .json({ success: false, message: 'Internal Server Error' });
    }
  }
}