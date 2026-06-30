import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  getLaravelWebhookUrl,
  getLaravelLegacyWebhookUrl,
  getLaravelWebhookSecret,
  getLaravelWebhookTimeout,
  getLaravelWebhookRetryCount,
  getLaravelWebhookRetryDelay,
} from '../utils/env-validator';

@Injectable()
export class PancakeWebhookForwardService {
  private readonly logger = new Logger(PancakeWebhookForwardService.name);

  /**
   * Forward payload to Laravel's new webhook endpoint (/api/webhooks/pancake).
   * Retries on network errors only (not on 4xx/5xx responses).
   */
  async forwardToLaravel(payload: Record<string, any>): Promise<boolean> {
    return this.postToLaravel(getLaravelWebhookUrl(), payload, 'LARAVEL_WEBHOOK_URL');
  }

  /**
   * Relay a raw, unmodified Pancake webhook payload to Laravel's legacy
   * endpoint (/api/webhook) — used for any event this service doesn't
   * specifically normalize, so existing Laravel-side handling keeps working.
   */
  async forwardToLegacyLaravel(payload: Record<string, any>): Promise<boolean> {
    return this.postToLaravel(
      getLaravelLegacyWebhookUrl(),
      payload,
      'LARAVEL_LEGACY_WEBHOOK_URL',
    );
  }

  private async postToLaravel(
    url: string,
    payload: Record<string, any>,
    envVarName: string,
  ): Promise<boolean> {
    if (!url) {
      this.logger.debug(`${envVarName} not set, skipping forward`);
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