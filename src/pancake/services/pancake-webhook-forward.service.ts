import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  getLaravelWebhookUrl,
  getLaravelWebhookSecret,
  getLaravelWebhookTimeout,
  getLaravelWebhookRetryCount,
  getLaravelWebhookRetryDelay,
} from '../utils/env-validator';

@Injectable()
export class PancakeWebhookForwardService {
  private readonly logger = new Logger(PancakeWebhookForwardService.name);

  /**
   * Forward payload to Laravel webhook.
   * Retries on network errors only (not on 4xx/5xx responses).
   */
  async forwardToLaravel(payload: Record<string, any>): Promise<boolean> {
    const url = getLaravelWebhookUrl();

    if (!url) {
      this.logger.debug('LARAVEL_WEBHOOK_URL not set, skipping forward');
      return false;
    }

    const secret = getLaravelWebhookSecret();
    const timeout = getLaravelWebhookTimeout();
    const maxRetries = getLaravelWebhookRetryCount();
    const retryDelayMs = getLaravelWebhookRetryDelay();
    const idempotencyKey = payload.idempotency_key || null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await axios.post(url, payload, {
          timeout,
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

        if (isNetworkError && attempt < maxRetries) {
          this.logger.warn(
            `Forward attempt ${attempt + 1} failed (network), retrying in ${retryDelayMs}ms…`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
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