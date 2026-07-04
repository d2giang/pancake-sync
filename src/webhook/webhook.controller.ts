import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebhookService } from './webhook.service';

@Controller('api/webhook')
export class WebhookController {
  constructor(private readonly service: WebhookService) {}

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

      // Native Pancake messaging belongs to /api/pancake/webhook. Keeping
      // this explicit prevents a silently successful 200 on the legacy URL
      // while no Laravel message save or Socket.IO emit takes place.
      if (data.event_type === 'messaging') {
        this.service.logLine(
          'Pancake messaging sent to legacy /api/webhook; configure /api/pancake/webhook',
          {
            page_id: data.page_id || null,
            conversation_id:
              data.data?.conversation?.conversation_id ||
              data.data?.conversation?.id ||
              null,
            message_id:
              data.data?.message?.message_id || data.data?.message?.id || null,
          },
          'ERROR',
        );
        return res.status(422).json({
          success: false,
          message: 'Use /api/pancake/webhook for Pancake messaging events',
        });
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
