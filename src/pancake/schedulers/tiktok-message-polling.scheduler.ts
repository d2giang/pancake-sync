import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RealtimeService } from '../../realtime/realtime.service';
import { parsePageTokens } from '../utils/env-validator';
import { PancakeApiService } from '../services/pancake-api.service';
import { LocalCacheService } from '../services/local-cache.service';
import { MessagingStatsService } from '../services/messaging-stats.service';
import { PancakeWebhookForwardService } from '../services/pancake-webhook-forward.service';
import { processPancakeMessagingWebhook } from '../services/pancake-messaging.processor';
import {
  PancakeConversation,
  PancakeMessage,
} from '../interfaces/pancake.interface';

function entriesFrom<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  if (!response || typeof response !== 'object') return [];
  const value = response as Record<string, unknown>;
  const entries =
    value.conversations || value.messages || value.data || value.entries;
  return Array.isArray(entries) ? (entries as T[]) : [];
}

/**
 * Pancake does not consistently deliver native messaging webhooks for TikTok.
 * Poll only recently-updated TikTok conversations as a near-realtime fallback.
 * Laravel's idempotency key remains the final deduplication guard across restarts.
 */
@Injectable()
export class TikTokMessagePollingScheduler {
  private readonly logger = new Logger(TikTokMessagePollingScheduler.name);
  private readonly seenMessageIds = new Set<string>();
  private lastPollAt = new Date(Date.now() - 2 * 60_000);
  private running = false;

  constructor(
    private readonly api: PancakeApiService,
    private readonly forwardService: PancakeWebhookForwardService,
    private readonly cache: LocalCacheService,
    private readonly realtimeService: RealtimeService,
    private readonly stats: MessagingStatsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'tiktok-message-polling' })
  async poll(): Promise<void> {
    if (process.env.TIKTOK_MESSAGE_POLLING_ENABLED === 'false' || this.running)
      return;

    const pageIds = Object.keys(parsePageTokens()).filter((id) =>
      id.startsWith('tt'),
    );
    if (pageIds.length === 0) return;

    this.running = true;
    const pollStartedAt = new Date();
    try {
      for (const pageId of pageIds) {
        await this.pollPage(pageId, this.lastPollAt.toISOString());
      }
      // Two-minute overlap protects against clock skew/eventual consistency.
      this.lastPollAt = new Date(pollStartedAt.getTime() - 2 * 60_000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`TikTok message polling failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async pollPage(pageId: string, updatedSince: string): Promise<void> {
    const response = await this.api.getConversations(pageId, {
      limit: Number(process.env.TIKTOK_MESSAGE_POLL_CONVERSATION_LIMIT || 50),
      updated_since: updatedSince,
    });
    const conversations = entriesFrom<PancakeConversation>(response);

    for (const conversation of conversations) {
      const conversationId = String(
        conversation?.conversation_id || conversation?.id || '',
      );
      if (!conversationId) continue;

      const messageResponse = await this.api.getConversationMessages(
        pageId,
        conversationId,
        {
          limit: Number(process.env.TIKTOK_MESSAGE_POLL_MESSAGE_LIMIT || 10),
        },
      );
      const messages = entriesFrom<PancakeMessage>(messageResponse);

      // Pancake normally returns newest first; process oldest first for stable UI order.
      for (const message of [...messages].reverse()) {
        const messageId = String(message?.message_id || message?.id || '');
        const dedupeKey = `${pageId}:${messageId}`;
        if (!messageId || this.seenMessageIds.has(dedupeKey)) continue;
        this.remember(dedupeKey);

        await processPancakeMessagingWebhook(
          {
            pageId,
            conversationId,
            messageId,
            conversation,
            message,
            receivedAt: new Date().toISOString(),
          },
          {
            forwardService: this.forwardService,
            cache: this.cache,
            realtimeService: this.realtimeService,
            stats: this.stats,
            logger: this.logger,
          },
        );
      }
    }
  }

  private remember(key: string): void {
    this.seenMessageIds.add(key);
    if (this.seenMessageIds.size <= 5000) return;
    const oldest: string | undefined = Array.from(this.seenMessageIds)[0];
    if (oldest) this.seenMessageIds.delete(oldest);
  }
}
