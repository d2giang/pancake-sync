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
  logger: Logger;
}

/** Central Pancake messaging pipeline used by the canonical /api/webhook. */
export async function processPancakeMessagingWebhook(
  job: MessagingWebhookJob,
  deps: MessagingProcessorDependencies,
): Promise<void> {
  const startedAt = Date.now();
  const { pageId, conversationId, conversation, message, receivedAt } = job;
  const { forwardService, cache, realtimeService, logger } = deps;

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
      const convOk = await forwardService.forwardToLaravel({
        event_version: '1.0',
        event: 'pancake_messaging',
        action: 'conversation_message_received',
        occurred_at: occurredAt,
        page_id: pageId,
        conversation_id: conversationId,
        ...buildLaravelConversationFields(summary),
      });
      const convDurationMs = Date.now() - convStartedAt;

      const msgStartedAt = Date.now();
      const msgOk = await forwardService.forwardToLaravel({
        event_version: '1.0',
        event: 'message_received',
        action: 'conversation_message_received',
        occurred_at: occurredAt,
        page_id: pageId,
        conversation_id: conversationId,
        ...buildLaravelMessageFields(pageId, conversationId, normalizedMessage),
      });
      const msgDurationMs = Date.now() - msgStartedAt;

      logger.log(
        `Laravel forward timing conversation_id=${conversationId}: ` +
          `conversation_save=${convDurationMs}ms(ok=${convOk}) message_save=${msgDurationMs}ms(ok=${msgOk})`,
      );

      if (convOk && msgOk) {
        const emitStartedAt = Date.now();
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
        logger.log(
          `Realtime emitted conversation_id=${conversationId} at=${new Date().toISOString()} ` +
            `emit_call_took=${Date.now() - emitStartedAt}ms`,
        );
      } else {
        logger.warn(
          `Laravel forward incomplete for conversation_id=${conversationId}: ` +
            `conversation_saved=${convOk} message_saved=${msgOk} — realtime emit skipped`,
        );
      }
    }
  } catch (error: any) {
    logger.error(
      `Background messaging webhook processing failed for conversation_id=${conversationId}: ${error?.message}`,
      error?.stack,
    );
  } finally {
    logger.log(
      `Background messaging webhook processing finished in ${Date.now() - startedAt}ms ` +
        `conversation_id=${conversationId} received_at=${receivedAt}`,
    );
  }
}
