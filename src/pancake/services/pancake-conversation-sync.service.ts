import { Injectable, Logger } from '@nestjs/common';
import { PancakeApiService } from './pancake-api.service';
import { LocalCacheService } from './local-cache.service';
import { PancakeWebhookForwardService } from './pancake-webhook-forward.service';
import { mapConversationToSummary } from '../mappers/pancake-conversation.mapper';
import { mapMessageToNormalized } from '../mappers/pancake-message.mapper';
import {
  buildLaravelConversationFields,
  buildLaravelMessageFields,
} from '../mappers/laravel-payload.mapper';
import {
  parsePageTokens,
  isForwardConversationEvents,
  isStoreConversationCache,
} from '../utils/env-validator';
import {
  PancakeConversation,
  SyncResult,
  LaravelConversationSyncPayload,
} from '../interfaces/pancake.interface';

@Injectable()
export class PancakeConversationSyncService {
  private readonly logger = new Logger(PancakeConversationSyncService.name);
  private isSyncing = false;

  constructor(
    private readonly pancakeApi: PancakeApiService,
    private readonly cache: LocalCacheService,
    private readonly forwardService: PancakeWebhookForwardService,
  ) {}

  /**
   * Backup sync conversations for all configured pages.
   * Runs on a scheduler. Designed to be idempotent.
   */
  async syncAllPages(): Promise<void> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping.');
      return;
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      const pages = parsePageTokens();
      const pageIds = Object.keys(pages);

      if (pageIds.length === 0) {
        this.logger.warn('No pages configured, skipping conversation sync.');
        return;
      }

      this.logger.log(`Starting conversation sync for ${pageIds.length} pages…`);

      for (const pageId of pageIds) {
        await this.syncPageConversations(pageId);
        // Small delay between pages to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Conversation sync completed in ${duration}s.`);
    } catch (error: any) {
      this.logger.error(`Conversation sync failed: ${error.message}`);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync a single page's conversations.
   * Prioritizes conversations updated in the last lookback period.
   */
  private async syncPageConversations(pageId: string): Promise<void> {
    const pageLimit =
      Number(process.env.PANCAKE_CONVERSATION_SYNC_PAGE_LIMIT || 50) || 50;
    const lookbackHours =
      Number(process.env.PANCAKE_CONVERSATION_SYNC_LOOKBACK_HOURS || 48) || 48;

    const result: SyncResult = {
      total_fetched: 0,
      synced: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      let allConversations: PancakeConversation[] = [];
      let hasMore = true;
      let after: string | undefined;

      // Fetch in pages
      while (hasMore) {
        const params: any = { limit: pageLimit };

        if (after) {
          params.after = after;
        }

        // If API supports updated_since, prioritize recent ones
        if (lookbackHours > 0) {
          const since = new Date(
            Date.now() - lookbackHours * 3600 * 1000,
          ).toISOString();
          params.updated_since = since;
        }

        try {
          const response = await this.pancakeApi.getConversations(pageId, params);

          const rawEntries: any[] =
            response?.conversations ||
            response?.data ||
            response?.entries ||
            (Array.isArray(response) ? response : []);

          const entries: PancakeConversation[] = Array.isArray(rawEntries)
            ? rawEntries
            : [];

          if (entries.length === 0) {
            hasMore = false;
            break;
          }

          allConversations = allConversations.concat(entries);
          result.total_fetched += entries.length;

          // Check pagination
          const pagination = response?.meta || response?.pagination || {};
          after = pagination?.after || pagination?.next_cursor || null;

          if (!after || entries.length < pageLimit) {
            hasMore = false;
          }
        } catch (error: any) {
          result.errors.push(
            `Page ${pageId}: fetch error: ${error.message}`,
          );
          hasMore = false;
        }
      }

      // Process each conversation
      for (const conv of allConversations) {
        try {
          const convId =
            String(conv.conversation_id || conv.id || '');

          if (!convId) {
            result.skipped++;
            continue;
          }

          // Normalize
          const summary = mapConversationToSummary(conv);

          // Cache locally (respect store flag)
          if (isStoreConversationCache()) {
            this.cache.upsertConversation(summary);
          }

          // Forward to Laravel (respect forward flag)
          if (isForwardConversationEvents()) {
            const payload: LaravelConversationSyncPayload = {
              event_version: '1.0',
              event: 'pancake_conversation',
              action: 'conversation_synced',
              occurred_at: new Date().toISOString(),
              page_id: pageId,
              conversation_id: convId,
              conversation_summary: summary,
              raw_conversation_data: conv,
              ...buildLaravelConversationFields(summary),
            };

            const ok = await this.forwardService.forwardToLaravel(payload);

            if (ok) {
              result.synced++;
            } else {
              result.failed++;
            }
          } else {
            result.synced++;
          }
        } catch (error: any) {
          result.failed++;
          result.errors.push(
            `Conv ${conv.conversation_id || conv.id}: ${error.message}`,
          );
        }
      }
    } catch (error: any) {
      result.errors.push(`Page ${pageId}: sync error: ${error.message}`);
      this.logger.error(`Sync page ${pageId} failed: ${error.message}`);
    }

    this.logger.log(
      `Page ${pageId} sync result: fetched=${result.total_fetched} synced=${result.synced} skipped=${result.skipped} failed=${result.failed}`,
    );

    if (result.errors.length > 0) {
      this.logger.warn(
        `Sync errors for page ${pageId}: ${result.errors.slice(0, 5).join('; ')}`,
      );
    }
  }

  /**
   * Sync a single conversation on demand (used by internal API).
   */
  async syncSingleConversation(
    pageId: string,
    conversationId: string,
  ): Promise<{ success: boolean; summary?: any }> {
    try {
      const conv = await this.pancakeApi.getConversationById(
        pageId,
        conversationId,
      );

      if (!conv) {
        return { success: false };
      }

      const summary = mapConversationToSummary(conv);

      // Cache locally (respect store flag)
      if (isStoreConversationCache()) {
        this.cache.upsertConversation(summary);
      }

      // Forward to Laravel (respect forward flag)
      if (isForwardConversationEvents()) {
        const payload: LaravelConversationSyncPayload = {
          event_version: '1.0',
          event: 'pancake_conversation',
          action: 'conversation_synced',
          occurred_at: new Date().toISOString(),
          page_id: pageId,
          conversation_id: conversationId,
          conversation_summary: summary,
          raw_conversation_data: conv,
          ...buildLaravelConversationFields(summary),
        };

        await this.forwardService.forwardToLaravel(payload);
      }

      // Backfill message history (best-effort; on-demand sync only —
      // not run on the periodic scheduler to avoid hammering Pancake/Laravel
      // for every conversation every cycle).
      if (isForwardConversationEvents()) {
        await this.backfillMessages(pageId, conversationId);
      }

      return { success: true, summary };
    } catch (error: any) {
      this.logger.error(
        `Sync single conversation ${conversationId} failed: ${error.message}`,
      );
      return { success: false };
    }
  }

  /**
   * Fetch and forward message history for a single conversation.
   * Errors are logged but do not fail the overall sync.
   */
  private async backfillMessages(
    pageId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      const response = await this.pancakeApi.getConversationMessages(
        pageId,
        conversationId,
      );

      // TEMP DIAGNOSTIC: response shape unconfirmed for this endpoint —
      // log it once so the real field name can be added below, mirroring
      // what we just learned for getConversations() (`conversations`, not
      // `data`/`entries`). Remove once confirmed.
      this.logger.log(
        `Pancake messages RAW response keys: ${JSON.stringify(Object.keys(response || {}))}`,
      );

      const rawMessages: any[] =
        response?.messages ||
        response?.conversations ||
        response?.data ||
        response?.entries ||
        (Array.isArray(response) ? response : []);

      if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        this.logger.warn(
          `No messages found in response for ${conversationId} — check RAW response keys log above for the real field name.`,
        );
        return;
      }

      for (const raw of rawMessages) {
        const normalized = mapMessageToNormalized(raw, pageId);

        await this.forwardService.forwardToLaravel({
          event_version: '1.0',
          event: 'message_received',
          action: 'conversation_message_received',
          occurred_at: new Date().toISOString(),
          page_id: pageId,
          conversation_id: conversationId,
          ...buildLaravelMessageFields(pageId, conversationId, normalized),
        });
      }

      this.logger.log(
        `Backfilled ${rawMessages.length} messages for conversation ${conversationId}`,
      );
    } catch (error: any) {
      this.logger.warn(
        `Message backfill failed for ${conversationId}: ${error.message}`,
      );
    }
  }
}