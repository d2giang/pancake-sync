import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  getLaravelWebhookSecret,
  getLaravelWebhookTimeout,
  getLaravelWebhookRetryCount,
  getLaravelWebhookRetryDelay,
  getLaravelTargets,
  type LaravelTargetConfig,
} from '../utils/env-validator';

@Injectable()
export class PancakeWebhookForwardService {
  private readonly logger = new Logger(PancakeWebhookForwardService.name);

  /**
   * Forward payload to Laravel's new webhook endpoint (/api/webhooks/pancake).
   * Retries on network errors only (not on 4xx/5xx responses).
   */
  async forwardToLaravel(payload: Record<string, any>): Promise<boolean> {
    const targets = getLaravelTargets().filter((target) => target.webhookUrl);
    return this.postToTargets(
      targets,
      'webhookUrl',
      payload,
      'LARAVEL_WEBHOOK_URL',
    );
  }

  /**
   * Relay a raw, unmodified Pancake webhook payload to Laravel's legacy
   * endpoint (/api/webhook) — used for any event this service doesn't
   * specifically normalize, so existing Laravel-side handling keeps working.
   */
  async forwardToLegacyLaravel(payload: Record<string, any>): Promise<boolean> {
    const targets = getLaravelTargets().filter(
      (target) => target.legacyWebhookUrl,
    );
    return this.postToTargets(
      targets,
      'legacyWebhookUrl',
      payload,
      'LARAVEL_LEGACY_WEBHOOK_URL',
    );
  }

  private async postToTargets(
    targets: LaravelTargetConfig[],
    urlKey: 'webhookUrl' | 'legacyWebhookUrl',
    payload: Record<string, any>,
    envVarName: string,
  ): Promise<boolean> {
    if (targets.length === 0) {
      this.logger.debug(`${envVarName} not set, skipping forward`);
      return false;
    }

    const results = await Promise.all(
      targets.map((target) =>
        this.postToLaravel(
          target[urlKey],
          payload,
          `${target.name}:${envVarName}`,
          target.webhookSecret,
        ),
      ),
    );

    // One CRM being temporarily unavailable must not suppress realtime for a
    // CRM that persisted the event successfully.
    return results.some(Boolean);
  }

  private async postToLaravel(
    url: string,
    payload: Record<string, any>,
    envVarName: string,
    webhookSecret?: string,
  ): Promise<boolean> {
    if (!url) {
      this.logger.debug(`${envVarName} not set, skipping forward`);
      return false;
    }

    const secret = webhookSecret ?? getLaravelWebhookSecret();
    const timeout = getLaravelWebhookTimeout();
    const maxRetries = getLaravelWebhookRetryCount();
    const retryDelayMs = getLaravelWebhookRetryDelay();
    const rawIdempotencyKey: unknown = payload.idempotency_key;
    const idempotencyKey =
      typeof rawIdempotencyKey === 'string' && rawIdempotencyKey
        ? rawIdempotencyKey
        : null;
    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': secret,
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await axios.post(url, payload, { timeout, headers });

        return true;
      } catch (error: unknown) {
        const axiosError = axios.isAxiosError(error) ? error : null;
        const errorCode = axiosError?.code;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const isNetworkError =
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ECONNRESET' ||
          errorCode === 'ETIMEDOUT' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'EPIPE';

        if (isNetworkError && attempt < maxRetries) {
          this.logger.warn(
            `Forward attempt ${attempt + 1} failed (network), retrying in ${retryDelayMs}ms…`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }

        // Log non-network errors once
        const status = axiosError?.response?.status;
        const responseData: unknown = axiosError?.response?.data;

        // Nhiều deployment chỉ cấu hình domain/base URL hoặc route webhook cũ.
        // Khi URL đó 404, thử đúng route Laravel hiện tại một lần. Không
        // fallback cho 401/403/500 vì đó là lỗi secret hoặc code phía Laravel.
        if (status === 404) {
          const canonicalUrl = this.canonicalWebhookUrl(url);
          if (canonicalUrl && canonicalUrl !== url) {
            try {
              await axios.post(canonicalUrl, payload, { timeout, headers });
              this.logger.warn(
                `${envVarName} returned 404; forwarded successfully via ${canonicalUrl}. ` +
                  `Update the configured webhook URL.`,
              );
              return true;
            } catch (fallbackError: unknown) {
              const fallbackAxiosError = axios.isAxiosError(fallbackError)
                ? fallbackError
                : null;
              const fallbackMessage =
                fallbackError instanceof Error
                  ? fallbackError.message
                  : String(fallbackError);
              this.logger.error(
                `${envVarName} canonical webhook fallback failed: ${fallbackMessage}` +
                  (fallbackAxiosError?.response?.status
                    ? ` [HTTP ${fallbackAxiosError.response.status}]`
                    : ''),
              );
            }
          }
        }

        this.logger.error(
          `${envVarName} forward failed: ${errorMessage}` +
            (status ? ` [HTTP ${status}]` : '') +
            (responseData ? ` ${JSON.stringify(responseData)}` : ''),
        );

        return false;
      }
    }

    return false;
  }

  private canonicalWebhookUrl(configuredUrl: string): string | null {
    try {
      const parsed = new URL(configuredUrl);
      parsed.pathname = '/api/webhooks/pancake';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }
}
