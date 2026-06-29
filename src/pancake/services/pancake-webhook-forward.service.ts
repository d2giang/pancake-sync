import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class PancakeWebhookForwardService {
  private readonly logger = new Logger(PancakeWebhookForwardService.name);
  private readonly maxRetries = 2;
  private readonly retryDelayMs = 2000;

  /**
   * Forward payload to Laravel webhook.
   * Retries on network errors only (not on 4xx/5xx responses).
   */
  async forwardToLaravel(payload: Record<string, any>): Promise<boolean> {
    const url = (process.env.LARAVEL_WEBHOOK_URL || '').trim();

    if (!url) {
      this.logger.debug('LARAVEL_WEBHOOK_URL not set, skipping forward');
      return false;
    }

    const secret = process.env.LARAVEL_WEBHOOK_SECRET || '';
    const idempotencyKey = payload.idempotency_key || null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await axios.post(url, payload, {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': secret,
            ...(idempotencyKey
              ? { 'X-Idempotency-Key': idempotencyKey }
              : {}),
          },
        });

        const action = payload.action || 'unknown';
        const conversationId = payload.conversation_id || 'unknown';

        this.logger.log(
          `Forwarded [${action}] for conversation ${conversationId} to Laravel`,
        );

        return true;
      } catch (error: any) {
        const isNetworkError =
          error.code === 'ECONNREFUSED' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'EPIPE';

        if (isNetworkError && attempt < this.maxRetries) {
          this.logger.warn(
            `Forward attempt ${attempt + 1} failed (network), retrying in ${this.retryDelayMs}ms…`,
          );
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
          continue;
        }

        // Log non-network errors once
        const status = error.response?.status;
        const responseData = error.response?.data;

        this.logger.error(
          `Forward to Laravel failed: ${error.message}` +
            (status ? ` [HTTP ${status}]` : '') +
            (responseData ? ` ${JSON.stringify(responseData)}` : ''),
        );

        return false;
      }
    }

    return false;
  }
}