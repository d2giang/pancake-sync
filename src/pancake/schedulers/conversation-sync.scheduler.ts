import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PancakeConversationSyncService } from '../services/pancake-conversation-sync.service';
import { isConversationSyncEnabled } from '../utils/env-validator';

@Injectable()
export class ConversationSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(ConversationSyncScheduler.name);

  constructor(private readonly syncService: PancakeConversationSyncService) {}

  onModuleInit() {
    const cron =
      process.env.PANCAKE_CONVERSATION_SYNC_CRON || '*/30 * * * *';

    this.logger.log(
      `Conversation sync scheduler registered (cron: ${cron}, enabled: ${isConversationSyncEnabled()})`,
    );
  }

  /**
   * Backup sync — runs on configurable cron (default: every 30 minutes).
   * Respects PANCAKE_CONVERSATION_SYNC_ENABLED toggle.
   */
  @Cron(
    process.env.PANCAKE_CONVERSATION_SYNC_CRON || '*/30 * * * *',
    {
      name: 'conversation-sync',
      timeZone: 'Asia/Bangkok',
    },
  )
  async handleConversationSync() {
    if (!isConversationSyncEnabled()) {
      this.logger.debug('Conversation sync is disabled, skipping.');
      return;
    }

    this.logger.log('Conversation sync triggered by scheduler');
    await this.syncService.syncAllPages();
  }
}
