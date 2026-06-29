import { Logger } from '@nestjs/common';
import { PageTokenConfig } from '../interfaces/pancake.interface';

const logger = new Logger('EnvValidator');

/**
 * Parse page tokens from env.
 * Priority:
 *   1. PANCAKE_PAGE_TOKENS (JSON multi-page)
 *   2. PANCAKE_PAGE_ID + PANCAKE_PAGE_ACCESS_TOKEN (single page fallback)
 * Returns empty object if none configured.
 */
export function parsePageTokens(): PageTokenConfig {
  // 1. Try multi-page JSON first
  const rawMulti = (process.env.PANCAKE_PAGE_TOKENS || '').trim();

  if (rawMulti) {
    try {
      const parsed = JSON.parse(rawMulti);

      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const config: PageTokenConfig = {};

        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && value.trim()) {
            config[key] = value.trim();
          } else {
            logger.warn(`Page token for page ${key} is empty or invalid, skipping.`);
          }
        }

        if (Object.keys(config).length > 0) {
          return config;
        }
      } else {
        logger.error('PANCAKE_PAGE_TOKENS must be a JSON object { pageId: token }.');
      }
    } catch {
      logger.error(
        'PANCAKE_PAGE_TOKENS is not valid JSON. Ensure it is a valid JSON object.',
      );
    }
  }

  // 2. Fallback to single page config
  const singlePageId = (process.env.PANCAKE_PAGE_ID || '').trim();
  const singleToken = (process.env.PANCAKE_PAGE_ACCESS_TOKEN || '').trim();

  if (singlePageId && singleToken) {
    logger.log(`Using single page config: page ${singlePageId}`);
    return { [singlePageId]: singleToken };
  }

  if (singlePageId && !singleToken) {
    logger.warn(
      `PANCAKE_PAGE_ID is set but PANCAKE_PAGE_ACCESS_TOKEN is empty.`,
    );
  }

  if (!singlePageId && singleToken) {
    logger.warn(
      `PANCAKE_PAGE_ACCESS_TOKEN is set but PANCAKE_PAGE_ID is empty.`,
    );
  }

  logger.warn('No Pancake page tokens configured. API calls to pages will fail.');
  return {};
}

/**
 * Get API token for a specific page.
 * Returns empty string if not found.
 */
export function getPageToken(pageId: string): string {
  const tokens = parsePageTokens();
  return tokens[pageId] || '';
}

/**
 * Get all configured page IDs.
 */
export function getAllPageIds(): string[] {
  return Object.keys(parsePageTokens());
}

// ---- Config accessors (with defaults from env) ----

export function getPancakePublicApiBaseUrl(): string {
  return (
    process.env.PANCAKE_PUBLIC_API_BASE_URL ||
    'https://pages.fm/api/public_api'
  ).replace(/\/$/, '');
}

export function getLaravelWebhookUrl(): string {
  return (process.env.LARAVEL_WEBHOOK_URL || '').trim();
}

export function getLaravelWebhookSecret(): string {
  return (process.env.LARAVEL_WEBHOOK_SECRET || '').trim();
}

export function getLaravelWebhookTimeout(): number {
  return Number(process.env.LARAVEL_WEBHOOK_TIMEOUT || 15000);
}

export function getLaravelWebhookRetryCount(): number {
  return Number(process.env.LARAVEL_WEBHOOK_RETRY_COUNT || 3);
}

export function getLaravelWebhookRetryDelay(): number {
  return Number(process.env.LARAVEL_WEBHOOK_RETRY_DELAY || 3000);
}

export function getPancakeApiTimeout(): number {
  return Number(process.env.PANCAKE_API_TIMEOUT || 15000);
}

export function getPancakeApiRetryCount(): number {
  return Number(process.env.PANCAKE_API_RETRY_COUNT || 3);
}

export function getPancakeApiRetryDelay(): number {
  return Number(process.env.PANCAKE_API_RETRY_DELAY || 2000);
}

export function isMessagingWebhookEnabled(): boolean {
  return process.env.PANCAKE_MESSAGING_WEBHOOK_ENABLED !== 'false';
}

export function isConversationSyncEnabled(): boolean {
  return process.env.PANCAKE_CONVERSATION_SYNC_ENABLED !== 'false';
}

export function isNoResponseCheckEnabled(): boolean {
  return process.env.NO_RESPONSE_CHECK_ENABLED !== 'false';
}

export function isIdempotencyEnabled(): boolean {
  return process.env.IDEMPOTENCY_ENABLED !== 'false';
}

export function getIdempotencyTtlDays(): number {
  return Number(process.env.IDEMPOTENCY_TTL_DAYS || 60);
}

export function isForwardRecordEvents(): boolean {
  return process.env.FORWARD_RECORD_EVENTS !== 'false';
}

export function isForwardMessagingEvents(): boolean {
  return process.env.FORWARD_MESSAGING_EVENTS !== 'false';
}

export function isForwardConversationEvents(): boolean {
  return process.env.FORWARD_CONVERSATION_EVENTS !== 'false';
}

export function isForwardNoResponseEvents(): boolean {
  return process.env.FORWARD_NO_RESPONSE_EVENTS !== 'false';
}

export function getDataStorageDriver(): string {
  return (process.env.DATA_STORAGE_DRIVER || 'file').toLowerCase();
}

export function isStoreConversationCache(): boolean {
  return process.env.STORE_CONVERSATION_CACHE !== 'false';
}

export function isStoreMessageCache(): boolean {
  return process.env.STORE_MESSAGE_CACHE !== 'false';
}

export function isStoreConversationSummaryCache(): boolean {
  return process.env.STORE_CONVERSATION_SUMMARY_CACHE !== 'false';
}

export function isStoreNoResponseCache(): boolean {
  return process.env.STORE_NO_RESPONSE_CACHE !== 'false';
}

export function getConfigFilePath(key: string, defaultPath: string): string {
  return (process.env[key] || defaultPath).trim();
}

export function isLogSyncSummary(): boolean {
  return process.env.LOG_SYNC_SUMMARY !== 'false';
}

export function isLogNoResponseSummary(): boolean {
  return process.env.LOG_NO_RESPONSE_SUMMARY !== 'false';
}

export function isAutoTagNoResponse1WEnabled(): boolean {
  return process.env.AUTO_TAG_NO_RESPONSE_1W_ENABLED === 'true';
}

export function isAutoTagNoResponse1MEnabled(): boolean {
  return process.env.AUTO_TAG_NO_RESPONSE_1M_ENABLED === 'true';
}

export function getAutoTagNoResponse1W(): string {
  return (process.env.AUTO_TAG_NO_RESPONSE_1W || '').trim();
}

export function getAutoTagNoResponse1M(): string {
  return (process.env.AUTO_TAG_NO_RESPONSE_1M || '').trim();
}

/**
 * Validate critical environment variables on app startup.
 * Logs warnings for missing configs (does not throw).
 */
export function validateEnv(): void {
  const publicApiUrl = getPancakePublicApiBaseUrl();
  const tokens = parsePageTokens();
  const laravelUrl = getLaravelWebhookUrl();
  const internalSecret = (process.env.INTERNAL_API_SECRET || '').trim();
  const storageDriver = getDataStorageDriver();

  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`Log level: ${process.env.LOG_LEVEL || 'info'}`);
  logger.log(`Storage driver: ${storageDriver}`);

  if (!publicApiUrl) {
    logger.warn('PANCAKE_PUBLIC_API_BASE_URL is not set. Pancake API calls will fail.');
  } else {
    logger.log(`Pancake Public API URL: ${publicApiUrl}`);
  }

  if (Object.keys(tokens).length === 0) {
    logger.warn('No Pancake page tokens configured.');
  } else {
    const redacted = Object.keys(tokens).reduce(
      (acc, pageId) => {
        acc[pageId] = '***';
        return acc;
      },
      {} as Record<string, string>,
    );
    logger.log(`Pancake pages configured: ${JSON.stringify(redacted)}`);
  }

  if (!laravelUrl) {
    logger.warn('LARAVEL_WEBHOOK_URL is not set. Forwarding will be skipped.');
  } else {
    logger.log(`Laravel forward URL: ${laravelUrl}`);
  }

  logger.log(
    `Internal API secret: ${internalSecret ? '***configured***' : '(not set!)'}`,
  );

  // Feature toggles
  logger.log(`Messaging webhook: ${isMessagingWebhookEnabled() ? 'ON' : 'OFF'}`);
  logger.log(`Conversation sync: ${isConversationSyncEnabled() ? 'ON' : 'OFF'}`);
  logger.log(`No-response check: ${isNoResponseCheckEnabled() ? 'ON' : 'OFF'}`);
  logger.log(`Idempotency: ${isIdempotencyEnabled() ? 'ON' : 'OFF'}`);

  // Forward toggles
  logger.log(`Forward records: ${isForwardRecordEvents() ? 'ON' : 'OFF'}`);
  logger.log(`Forward messaging: ${isForwardMessagingEvents() ? 'ON' : 'OFF'}`);
  logger.log(`Forward conversations: ${isForwardConversationEvents() ? 'ON' : 'OFF'}`);
  logger.log(`Forward no-response: ${isForwardNoResponseEvents() ? 'ON' : 'OFF'}`);

  // Cron configs
  const syncCron = process.env.PANCAKE_CONVERSATION_SYNC_CRON || '*/30 * * * *';
  const noResponseCron = process.env.NO_RESPONSE_CHECK_CRON || '0 * * * *';
  logger.log(`Conversation sync cron: ${syncCron}`);
  logger.log(`No-response check cron: ${noResponseCron}`);
  logger.log(`Sync lookback hours: ${process.env.PANCAKE_CONVERSATION_SYNC_LOOKBACK_HOURS || 48}`);
  logger.log(`No-response thresholds: 1W=${process.env.NO_RESPONSE_1W_DAYS || 7}d, 1M=${process.env.NO_RESPONSE_1M_DAYS || 30}d`);

  // Autotag
  if (isAutoTagNoResponse1WEnabled()) {
    logger.log(`Auto-tag 1W enabled: tag="${getAutoTagNoResponse1W()}"`);
  }
  if (isAutoTagNoResponse1MEnabled()) {
    logger.log(`Auto-tag 1M enabled: tag="${getAutoTagNoResponse1M()}"`);
  }
}