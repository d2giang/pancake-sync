import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PancakeWebhookForwardService } from '../services/pancake-webhook-forward.service';
import { LocalCacheService } from '../services/local-cache.service';
import { mapConversationToSummary } from '../mappers/pancake-conversation.mapper';
import { mapMessageToNormalized } from '../mappers/pancake-message.mapper';
import {
  PancakeMessagingWebhookPayload,
  LaravelMessagingPayload,
} from '../interfaces/pancake.interface';
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

      // Only handle messaging webhooks
      if (eventType !== 'messaging') {
        this.logger.debug(`Ignoring non-messaging event: ${eventType}`);
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
        const payload: LaravelMessagingPayload = {
          event_version: '1.0',
          event: 'pancake_messaging',
          action: 'conversation_message_received',
          occurred_at: new Date().toISOString(),
          page_id: pageId,
          conversation_id: conversationId,
          conversation_summary: summary,
          message: normalizedMessage,
          raw_conversation_data: conversation,
          raw_message_data: message,
        };

        await this.forwardService.forwardToLaravel(payload);
      }

      this.logger.log(
        `Processed messaging webhook for conversation ${conversationId} (page ${pageId})`,
      );

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