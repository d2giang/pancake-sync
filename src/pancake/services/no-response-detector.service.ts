import { Injectable, Logger } from '@nestjs/common';
import { LocalCacheService } from './local-cache.service';
import { PancakeWebhookForwardService } from './pancake-webhook-forward.service';
import { parsePageTokens } from '../utils/env-validator';
import {
  ConversationSummary,
  LaravelNoResponsePayload,
} from '../interfaces/pancake.interface';

@Injectable()
export class NoResponseDetectorService {
  private readonly logger = new Logger(NoResponseDetectorService.name);
  private isRunning = false;

  constructor(
    private readonly cache: LocalCacheService,
    private readonly forwardService: PancakeWebhookForwardService,
  ) {}

  /**
   * Check all cached conversations for no-response conditions.
   * Runs on a scheduler (e.g., every hour).
   */
  async checkAllPages(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('No-response check already in progress, skipping.');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const conversations = this.cache.getCachedConversations();
      const pages = parsePageTokens();
      const pageIds = new Set(Object.keys(pages));

      if (conversations.length === 0) {
        this.logger.log('No cached conversations to check.');
        return;
      }

      // Filter conversations belonging to configured pages
      const relevant = conversations.filter((c) =>
        pageIds.has(c.page_id),
      );

      this.logger.log(
        `Checking ${relevant.length} conversations for no-response…`,
      );

      let detected1W = 0;
      let detected1M = 0;
      let skipped = 0;

      for (const cached of relevant) {
        const summary = cached.summary;
        if (!summary) {
          skipped++;
          continue;
        }

        // Check 1W
        const result1W = this.evaluateNoResponse1W(summary);
        if (result1W) {
          await this.emitNoResponseEvent(summary, result1W);
          detected1W++;
        }

        // Check 1M
        const result1M = this.evaluateNoResponse1M(summary);
        if (result1M) {
          await this.emitNoResponseEvent(summary, result1M);
          detected1M++;
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `No-response check done in ${duration}s: 1W=${detected1W} 1M=${detected1M} skipped=${skipped}`,
      );
    } catch (error: any) {
      this.logger.error(`No-response check failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Evaluate if a conversation qualifies for "No Response 1 Week".
   * Returns payload data if qualified, null otherwise.
   */
  private evaluateNoResponse1W(
    summary: ConversationSummary,
  ): Omit<LaravelNoResponsePayload, 'occurred_at'> | null {
    const daysThreshold =
      Number(process.env.NO_RESPONSE_1W_DAYS || 7) || 7;

    return this.evaluateNoResponse(summary, {
      days: daysThreshold,
      action: 'no_response_1w',
      statusCode: 4,
      statusLabel: 'No Response 1w',
    });
  }

  /**
   * Evaluate if a conversation qualifies for "No Response 1 Month".
   * Returns payload data if qualified, null otherwise.
   */
  private evaluateNoResponse1M(
    summary: ConversationSummary,
  ): Omit<LaravelNoResponsePayload, 'occurred_at'> | null {
    const daysThreshold =
      Number(process.env.NO_RESPONSE_1M_DAYS || 30) || 30;

    return this.evaluateNoResponse(summary, {
      days: daysThreshold,
      action: 'no_response_1m',
      statusCode: 5,
      statusLabel: 'No Response 1m',
    });
  }

  /**
   * Core no-response evaluation logic.
   */
  private evaluateNoResponse(
    summary: ConversationSummary,
    config: {
      days: number;
      action: 'no_response_1w' | 'no_response_1m';
      statusCode: number;
      statusLabel: string;
    },
  ): (Omit<LaravelNoResponsePayload, 'occurred_at'> & {
      action: 'no_response_1w' | 'no_response_1m';
    }) | null {
    const { days, action, statusCode, statusLabel } = config;

    // Must have conversation_id
    if (!summary.conversation_id) return null;

    // Last outbound message must exist
    const lastOutbound = summary.last_outbound_message_at;
    if (!lastOutbound) return null;

    // Check time threshold
    const lastOutboundDate = new Date(lastOutbound).getTime();
    if (isNaN(lastOutboundDate)) return null;

    const now = Date.now();
    const diffMs = now - lastOutboundDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < days) return null;

    // Last message must be from page/admin/bot (outbound)
    const outboundTypes: string[] = ['page', 'admin', 'bot'];
    if (!outboundTypes.includes(summary.last_message_from)) return null;

    // Customer has NOT replied after that outbound
    const lastCustomerAt = summary.last_customer_message_at;
    if (lastCustomerAt) {
      const lastCustomerDate = new Date(lastCustomerAt).getTime();
      if (!isNaN(lastCustomerDate) && lastCustomerDate > lastOutboundDate) {
        // Customer replied after outbound → no longer qualifies
        return null;
      }
    }

    // Idempotency check
    const idempotencyKey = `${action}:${summary.conversation_id}:${lastOutbound}`;

    // Check if already sent
    const alreadySent = this.cache.hasNoResponseEventBeenSent(
      summary.conversation_id,
      action,
      idempotencyKey,
    );

    if (alreadySent) return null;

    // Build payload
    return {
      event_version: '1.0',
      event: 'candidate_status',
      action,
      conversation_id: summary.conversation_id,
      pancake_page_id: summary.page_id,
      facebook_id: summary.customer_fb_id,
      pancake_customer_id: summary.customer_id,
      status_code: statusCode,
      status_label: statusLabel,
      idempotency_key: idempotencyKey,
      metrics: {
        last_message_from: summary.last_message_from,
        last_message_at: summary.last_message_at,
        last_customer_message_at: summary.last_customer_message_at,
        last_outbound_message_at: lastOutbound,
        days_since_last_outbound_message: Math.floor(diffDays),
      },
    };
  }

  /**
   * Emit a no-response event: forward to Laravel and record locally.
   */
  private async emitNoResponseEvent(
    summary: ConversationSummary,
    eventData: Omit<LaravelNoResponsePayload, 'occurred_at'> & {
      action: 'no_response_1w' | 'no_response_1m';
    },
  ) {
    const payload: LaravelNoResponsePayload = {
      ...eventData,
      occurred_at: new Date().toISOString(),
    };

    const ok = await this.forwardService.forwardToLaravel(payload);

    if (ok) {
      // Record in local cache for idempotency
      this.cache.appendNoResponseEvent({
        conversation_id: summary.conversation_id,
        action: eventData.action,
        sent_at: payload.occurred_at,
        idempotency_key: eventData.idempotency_key,
        last_outbound_message_at:
          eventData.metrics.last_outbound_message_at,
      });

      // Update no-response cache
      const cacheEntry = this.cache.getNoResponseCacheEntry(
        summary.conversation_id,
      ) || {};

      if (eventData.action === 'no_response_1w') {
        cacheEntry.no_response_1w_sent_at = payload.occurred_at;
        cacheEntry.last_no_response_1w_idempotency_key =
          eventData.idempotency_key;
      } else {
        cacheEntry.no_response_1m_sent_at = payload.occurred_at;
        cacheEntry.last_no_response_1m_idempotency_key =
          eventData.idempotency_key;
      }

      this.cache.setNoResponseCacheEntry(
        summary.conversation_id,
        cacheEntry,
      );

      this.logger.log(
        `Emitted ${eventData.action} for conversation ${summary.conversation_id}`,
      );
    }
  }
}