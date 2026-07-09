import { Logger } from '@nestjs/common';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  PancakeConversation,
  PancakeMessage,
} from '../interfaces/pancake.interface';
import {
  buildLaravelConversationFields,
  buildLaravelMessageFields,
} from '../mappers/laravel-payload.mapper';
import { mapConversationToSummary } from '../mappers/pancake-conversation.mapper';
import { mapMessageToNormalized } from '../mappers/pancake-message.mapper';
import {
  isForwardMessagingEvents,
  isStoreConversationCache,
  isStoreMessageCache,
} from '../utils/env-validator';
import { LocalCacheService } from './local-cache.service';
import { PancakeWebhookForwardService } from './pancake-webhook-forward.service';
import { MessagingStatsService } from './messaging-stats.service';

export interface MessagingWebhookJob {
  pageId: string;
  conversationId: string;
  messageId: string;
  conversation: PancakeConversation;
  message: PancakeMessage;
  receivedAt: string;
}

export interface MessagingProcessorDependencies {
  forwardService: PancakeWebhookForwardService;
  cache: LocalCacheService;
  realtimeService: RealtimeService;
  stats: MessagingStatsService;
  logger: Logger;
}

/** Central Pancake messaging pipeline used by the canonical /api/webhook. */
export async function processPancakeMessagingWebhook(
  job: MessagingWebhookJob,
  deps: MessagingProcessorDependencies,
): Promise<void> {
  const startedAt = Date.now();
  const { pageId, conversationId, conversation, message, receivedAt } = job;
  const { forwardService, cache, realtimeService, stats, logger } = deps;

  let convOk: boolean | null = null;
  let msgOk: boolean | null = null;
  let convDurationMs = 0;
  let msgDurationMs = 0;

  try {
    const summary = mapConversationToSummary(conversation, pageId);
    const normalizedMessage = mapMessageToNormalized(message, pageId);

    try {
      if (isStoreConversationCache()) cache.upsertConversation(summary);
      if (isStoreMessageCache()) {
        cache.appendMessage({
          conversation_id: conversationId,
          normalized_message: normalizedMessage,
          raw_message: message,
        });
      }
    } catch (cacheError: any) {
      logger.error(
        `Local cache write failed for conversation_id=${conversationId}: ${cacheError?.message}`,
        cacheError?.stack,
      );
    }

    if (isForwardMessagingEvents()) {
      const occurredAt = new Date().toISOString();
      const convStartedAt = Date.now();
      convOk = await forwardService.forwardToLaravel({
        event_version: '1.0',
        event: 'pancake_messaging',
        action: 'conversation_message_received',
        occurred_at: occurredAt,
        page_id: pageId,
        conversation_id: conversationId,
        ...buildLaravelConversationFields(summary),
      });
      convDurationMs = Date.now() - convStartedAt;

      const msgStartedAt = Date.now();
      msgOk = await forwardService.forwardToLaravel({
        event_version: '1.0',
        event: 'message_received',
        action: 'conversation_message_received',
        occurred_at: occurredAt,
        page_id: pageId,
        conversation_id: conversationId,
        ...buildLaravelMessageFields(pageId, conversationId, normalizedMessage),
      });
      msgDurationMs = Date.now() - msgStartedAt;

      if (convOk && msgOk) {
        const messageId = String(normalizedMessage?.message_id || '');
        realtimeService.emitMessageCreated({
          page_id: pageId,
          conversation_id: conversationId,
          message_id: messageId || undefined,
          timestamp: occurredAt,
          source: 'pancake',
        });
        realtimeService.emitConversationUpdated({
          page_id: pageId,
          conversation_id: conversationId,
          timestamp: occurredAt,
          source: 'pancake',
        });
      } else {
        logger.warn(
          `Laravel forward incomplete for conversation_id=${conversationId}: ` +
            `conversation_saved=${convOk} message_saved=${msgOk} — realtime emit skipped`,
        );
      }
    }
  } catch (error: any) {
    logger.error(
      `Messaging webhook processing failed for conversation_id=${conversationId}: ${error?.message}`,
      error?.stack,
    );
  } finally {
    const totalMs = Date.now() - startedAt;
    const forwardSummary = isForwardMessagingEvents()
      ? `conv=${convDurationMs}ms(${convOk}) msg=${msgDurationMs}ms(${msgOk})`
      : 'off';

    // Per-message detail is debug-only — a single busy conversation can send
    // dozens of messages a minute, so logging one line per message still
    // floods the console. MessagingStatsService rolls these up into one
    // periodic summary line instead (see messaging-stats.service.ts).
    logger.debug(
      `Pancake message processed conversation_id=${conversationId} page_id=${pageId} ` +
        `forward=${forwardSummary} total=${totalMs}ms received_at=${receivedAt}`,
    );

    stats.record({
      conversationId,
      ok: isForwardMessagingEvents() ? !!(convOk && msgOk) : true,
      durationMs: totalMs,
    });
  }
}
