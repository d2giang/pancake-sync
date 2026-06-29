import { Logger } from '@nestjs/common';
import { PageTokenConfig } from '../interfaces/pancake.interface';

const logger = new Logger('EnvValidator');

/**
 * Parse PANCAKE_PAGE_TOKENS from env string (JSON format).
 * Expected: '{"331141913426390":"token_page_1","123456":"token_page_2"}'
 * Returns empty object if not set or invalid.
 */
export function parsePageTokens(): PageTokenConfig {
  const raw = (process.env.PANCAKE_PAGE_TOKENS || '').trim();

  if (!raw) {
    logger.warn(
      'PANCAKE_PAGE_TOKENS is empty. No pages configured for Pancake API.',
    );
    return {};
  }

  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      logger.error(
        'PANCAKE_PAGE_TOKENS must be a JSON object { pageId: token }.',
      );
      return {};
    }

    const config: PageTokenConfig = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) {
        config[key] = value.trim();
      } else {
        logger.warn(`Page token for page ${key} is empty or invalid, skipping.`);
      }
    }

    if (Object.keys(config).length === 0) {
      logger.warn('No valid page tokens found in PANCAKE_PAGE_TOKENS.');
    }

    return config;
  } catch {
    logger.error(
      'PANCAKE_PAGE_TOKENS is not valid JSON. Ensure it is a valid JSON object.',
    );
    return {};
  }
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
 * Validate critical environment variables on app startup.
 * Logs warnings for missing configs (does not throw).
 */
export function validateEnv(): void {
  const baseUrl = (process.env.PANCAKE_BASE_URL || '').trim();
  const tokens = parsePageTokens();
  const laravelUrl = (process.env.LARAVEL_WEBHOOK_URL || '').trim();
  const internalSecret = (process.env.INTERNAL_API_SECRET || '').trim();

  if (!baseUrl) {
    logger.warn(
      'PANCAKE_BASE_URL is not set. Pancake API calls will fail.',
    );
  }

  if (Object.keys(tokens).length === 0) {
    logger.warn(
      'No PANCAKE_PAGE_TOKENS configured. Pancake API calls to pages will fail.',
    );
  } else {
    // Log page IDs (never tokens) for debugging
    const redactedTokens = Object.keys(tokens).reduce(
      (acc, pageId) => {
        acc[pageId] = '***';
        return acc;
      },
      {} as Record<string, string>,
    );

    logger.log(`Pancake pages configured: ${JSON.stringify(redactedTokens)}`);
  }

  if (!laravelUrl) {
    logger.warn(
      'LARAVEL_WEBHOOK_URL is not set. Forwarding to Laravel will be skipped.',
    );
  }

  if (!internalSecret) {
    logger.warn(
      'INTERNAL_API_SECRET is not set. Internal APIs will accept any request (not secure!).',
    );
  }

  const syncCron =
    process.env.PANCAKE_CONVERSATION_SYNC_CRON || '*/30 * * * *';
  const noResponseCron =
    process.env.NO_RESPONSE_CHECK_CRON || '0 * * * *';

  logger.log(`Conversation sync cron: ${syncCron}`);
  logger.log(`No-response check cron: ${noResponseCron}`);
  logger.log(`Laravel forward URL: ${laravelUrl || '(not set)'}`);
  logger.log(
    `Internal API secret: ${internalSecret ? '***configured***' : '(not set)'}`,
  );
}