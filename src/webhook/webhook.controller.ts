import { Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebhookService } from './webhook.service';
import { PancakeWebhookForwardService } from '../pancake/services/pancake-webhook-forward.service';
import { LocalCacheService } from '../pancake/services/local-cache.service';
import { RealtimeService } from '../realtime/realtime.service';
import { processPancakeMessagingWebhook } from '../pancake/services/pancake-messaging.processor';
import { MessagingStatsService } from '../pancake/services/messaging-stats.service';
import { isMessagingWebhookEnabled } from '../pancake/utils/env-validator';

@Controller('api/webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly service: WebhookService,
    private readonly forwardService: PancakeWebhookForwardService,
    private readonly cache: LocalCacheService,
    private readonly realtimeService: RealtimeService,
    private readonly stats: MessagingStatsService,
  ) {}

  @Get()
  async handleGet(@Query() query: any, @Res() res: Response) {
    if (query.ref_sync !== undefined) {
      const html = await this.service.renderRefSyncDashboard(query);
      return res.status(200).type('text/html; charset=utf-8').send(html);
    }

    if (query.records !== undefined) {
      return res.json(this.service.getPancakeRecords(Number(query.page || 1)));
    }

    const mode = query['hub.mode'] || query.hub_mode;
    const token = query['hub.verify_token'] || query.hub_verify_token;
    const challenge = query['hub.challenge'] || query.hub_challenge;

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return res
        .status(200)
        .type('text/plain')
        .send(String(challenge || ''));
    }

    return res.status(403).type('text/plain').send('Forbidden');
  }

  @Post()
  async handlePost(
    @Req() req: Request & { rawBody?: string },
    @Res() res: Response,
  ) {
    try {
      const rawBody = req.rawBody || JSON.stringify(req.body || {});
      const data = req.body;

      if (!data || typeof data !== 'object') {
        this.service.logLine('Invalid JSON payload', {}, 'ERROR');
        return res.status(400).type('text/plain').send('Bad Request');
      }

      if (data.event_type === 'messaging') {
        if (!isMessagingWebhookEnabled()) {
          return res
            .status(200)
            .json({ success: true, message: 'Webhook disabled' });
        }

        const pageId = String(data.page_id || '');
        const conversation = data.data?.conversation;
        const message = data.data?.message;
        const conversationId = String(
          conversation?.conversation_id || conversation?.id || '',
        );
        const messageId = String(message?.message_id || message?.id || '');
        const receivedAt = new Date().toISOString();

        // Debug-only — the processor's "Pancake message processed" summary
        // (logged once processing finishes) is the one line per message
        // worth keeping at info level; this one just duplicates it earlier.
        this.logger.debug(
          `Pancake messaging received page_id=${pageId || '(none)'} ` +
            `conversation_id=${conversationId || '(none)'} message_id=${messageId || '(none)'}`,
        );

        if (!pageId || !conversation || !message) {
          this.logger.warn('Missing required fields in messaging webhook');
          return res.status(200).json({ success: true, message: 'OK' });
        }

        res.status(200).json({ success: true, message: 'EVENT_RECEIVED' });
        void processPancakeMessagingWebhook(
          {
            pageId,
            conversationId,
            messageId,
            conversation,
            message,
            receivedAt,
          },
          {
            forwardService: this.forwardService,
            cache: this.cache,
            realtimeService: this.realtimeService,
            stats: this.stats,
            logger: this.logger,
          },
        );
        return;
      }

      this.service.cleanOldPendingRefs().catch(() => undefined);

      this.service.logLine('Webhook POST received', {
        object: data.object || null,
        event: data.event || null,
        action: data.action || null,
        type: data.type || null,
        event_type: data.event_type || null,
        has_table_id: !!data.table_id,
        has_conversation_id: !!data.conversation_id,
      });

      if (
        this.service.isPancakePayload(data) ||
        this.service.isPancakeCreatedRecord(data) ||
        this.service.isPancakeUpdatedRecord(data)
      ) {
        await this.service.handlePancakeWebhook(data);
        return res.status(200).type('text/plain').send('EVENT_RECEIVED');
      }

      // Other native Pancake events (comments, tags, etc.) continue to the
      // Laravel legacy webhook. Respond first so Pancake does not retry while
      // Laravel is processing the event.
      if (data.event_type) {
        res.status(200).type('text/plain').send('EVENT_RECEIVED');
        void this.forwardService
          .forwardToLegacyLaravel(data)
          .catch((error: any) => {
            this.logger.error(
              `Legacy Pancake relay failed event_type=${data.event_type}: ${error?.message}`,
            );
          });
        return;
      }

      if (data.object === 'page') {
        const signature = req.header('x-hub-signature-256') || '';

        if (!this.service.verifySignature(rawBody, signature)) {
          return res.status(403).type('text/plain').send('Invalid signature');
        }

        this.service.logLine('Meta page webhook received', {
          entries: Array.isArray(data.entry) ? data.entry.length : 0,
          events: (data.entry || []).reduce(
            (total: number, entry: any) =>
              total +
              (Array.isArray(entry.messaging) ? entry.messaging.length : 0) +
              (Array.isArray(entry.standby) ? entry.standby.length : 0),
            0,
          ),
        });

        for (const entry of data.entry || []) {
          for (const event of entry.messaging || []) {
            await this.service.processMessagingEvent(event);
          }

          for (const event of entry.standby || []) {
            await this.service.processMessagingEvent(event);
          }
        }

        return res.status(200).type('text/plain').send('EVENT_RECEIVED');
      }

      return res.status(200).type('text/plain').send('EVENT_RECEIVED');
    } catch (error: any) {
      this.service.logLine(
        'Unhandled exception',
        {
          message: error.message,
          stack: error.stack,
        },
        'ERROR',
      );

      return res.status(500).type('text/plain').send('Internal Server Error');
    }
  }
}
