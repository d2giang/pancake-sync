import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { PancakeConversationSyncService } from '../services/pancake-conversation-sync.service';
import { PancakeApiService } from '../services/pancake-api.service';
import { getAllPageIds } from '../utils/env-validator';

/**
 * Public GET routes for triggering sync operations via browser/curl.
 * Pattern: GET /api/sync/... (no body, optional ?secret= for protection).
 *
 * Protected by INTERNAL_API_SECRET env var (query param ?secret=xxx).
 * If INTERNAL_API_SECRET is not set, all routes are open (dev mode).
 */
@Controller('api/sync')
export class PancakeSyncController {
  private readonly logger = new Logger(PancakeSyncController.name);

  constructor(
    private readonly syncService: PancakeConversationSyncService,
    private readonly pancakeApi: PancakeApiService,
  ) {}

  private checkSecret(secret?: string): { ok: boolean; error?: string } {
    const expected = (process.env.INTERNAL_API_SECRET || '').trim();
    if (!expected) return { ok: true }; // dev fallback — no secret configured
    if (!secret || secret.trim() !== expected) {
      return { ok: false, error: 'Invalid or missing ?secret= param' };
    }
    return { ok: true };
  }

  /**
   * GET /api/sync/status
   * List configured pages and sync settings.
   */
  @Get('status')
  getStatus(@Query('secret') secret?: string) {
    const check = this.checkSecret(secret);
    if (!check.ok) return { success: false, error: check.error };

    const pageIds = getAllPageIds();
    return {
      success: true,
      pages: pageIds,
      settings: {
        sync_enabled: process.env.PANCAKE_CONVERSATION_SYNC_ENABLED !== 'false',
        cron: process.env.PANCAKE_CONVERSATION_SYNC_CRON || '*/30 * * * *',
        lookback_hours: Number(process.env.PANCAKE_CONVERSATION_SYNC_LOOKBACK_HOURS || 48),
        forward_conversations: process.env.FORWARD_CONVERSATION_EVENTS !== 'false',
        forward_messaging: process.env.FORWARD_MESSAGING_EVENTS !== 'false',
      },
    };
  }

  /**
   * GET /api/sync/conversations
   * Trigger full sync for all configured pages (conversations only, no messages).
   */
  @Get('conversations')
  async syncAllConversations(
    @Query('secret') secret?: string,
    @Query('full') full?: string,
  ) {
    const check = this.checkSecret(secret);
    if (!check.ok) return { success: false, error: check.error };

    const isFull = full === '1' || full === 'true';
    this.logger.log(`Manual sync triggered: full=${isFull}`);
    await this.syncService.syncAllPages(isFull);
    return { success: true, message: `Conversation sync completed (full=${isFull})` };
  }

  /**
   * GET /api/sync/conversations/:pageId
   * Trigger conversation sync for a single page.
   * ?full=1 → bỏ filter thời gian, lấy toàn bộ lịch sử.
   */
  @Get('conversations/:pageId')
  async syncPageConversations(
    @Param('pageId') pageId: string,
    @Query('secret') secret?: string,
    @Query('full') full?: string,
  ) {
    const check = this.checkSecret(secret);
    if (!check.ok) return { success: false, error: check.error };

    const isFull = full === '1' || full === 'true';
    this.logger.log(`Manual page sync triggered: page=${pageId} full=${isFull}`);
    await this.syncService.syncPageOnly(pageId, isFull);
    return { success: true, message: `Conversations synced for page ${pageId} (full=${isFull})` };
  }

  /**
   * GET /api/sync/messages/:pageId/:conversationId
   * Trigger full message backfill for a single conversation (all pages, paginated).
   */
  @Get('messages/:pageId/:conversationId')
  async backfillMessages(
    @Param('pageId') pageId: string,
    @Param('conversationId') conversationId: string,
    @Query('secret') secret?: string,
  ) {
    const check = this.checkSecret(secret);
    if (!check.ok) return { success: false, error: check.error };

    this.logger.log(`Manual message backfill: page=${pageId} conv=${conversationId}`);
    const result = await this.syncService.syncSingleConversation(pageId, conversationId);
    return {
      success: result.success,
      message: result.success
        ? `Messages backfilled for conversation ${conversationId}`
        : 'Backfill failed — check logs',
    };
  }

  /**
   * GET /api/sync/messages/:pageId
   * Trigger message backfill for ALL conversations of a page.
   * Heavy operation — use with caution on production.
   */
  @Get('messages/:pageId')
  async backfillAllMessages(
    @Param('pageId') pageId: string,
    @Query('secret') secret?: string,
  ) {
    const check = this.checkSecret(secret);
    if (!check.ok) return { success: false, error: check.error };

    this.logger.log(`Manual full message backfill triggered: page=${pageId}`);
    // Run async — don't block the HTTP response for large pages
    this.syncService.backfillAllConversationMessages(pageId).catch((err) =>
      this.logger.error(`Full message backfill failed: ${err.message}`),
    );
    return {
      success: true,
      message: `Full message backfill started for page ${pageId}. Check server logs for progress.`,
    };
  }

  /**
   * GET /api/sync/debug/conversations/:pageId
   * Trả raw response từ Pancake API (1 trang) để kiểm tra cấu trúc pagination.
   * ?last_c=xxx để test cursor trang tiếp theo.
   */
  @Get('debug/conversations/:pageId')
  async debugConversations(
    @Param('pageId') pageId: string,
    @Query('secret') secret?: string,
    @Query('last_c') lastC?: string,
    @Query('limit') limit?: string,
  ) {
    const check = this.checkSecret(secret);
    if (!check.ok) return { success: false, error: check.error };

    const raw = await this.pancakeApi.getConversations(pageId, {
      limit: limit ? Number(limit) : 5,
      ...(lastC ? { last_c: lastC } : {}),
    });

    // Trả toàn bộ raw response để xem cấu trúc cursor
    const entries: any[] =
      (raw as any)?.conversations ||
      (raw as any)?.data ||
      (raw as any)?.entries ||
      (Array.isArray(raw) ? raw : []);

    return {
      total_in_page: entries.length,
      // Các field cursor có thể có
      last_c: (raw as any)?.last_c ?? null,
      paging: (raw as any)?.paging ?? null,
      meta: (raw as any)?.meta ?? null,
      pagination: (raw as any)?.pagination ?? null,
      // Toàn bộ keys ở root (để phát hiện field lạ)
      root_keys: Object.keys(raw as any),
      // 2 conversation đầu để confirm data
      sample: entries.slice(0, 2).map((c: any) => ({
        id: c.id,
        conversation_id: c.conversation_id,
        customer_name: c.customer_name,
      })),
    };
  }
}
