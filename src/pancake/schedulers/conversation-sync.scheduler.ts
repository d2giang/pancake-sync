import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PancakeConversationSyncService } from '../services/pancake-conversation-sync.service';

@Injectable()
export class ConversationSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(ConversationSyncScheduler.name);

  constructor(private readonly syncService: PancakeConversationSyncService) {}

  onModuleInit() {
    const cron =
      process.env.PANCAKE_CONVERSATION_SYNC_CRON || '*/30 * * * *';

    this.logger.log(
      `Conversation sync scheduler registered (cron: ${cron})`,
    );
  }

  /**
   * Backup sync — runs on configurable cron (default: every 30 minutes).
   */
  @Cron(
    process.env.PANCAKE_CONVERSATION_SYNC_CRON || '*/30 * * * *',
    {
      name: 'conversation-sync',
      timeZone: 'Asia/Bangkok',
    },
  )
  async handleConversationSync() {
    this.logger.log('Conversation sync triggered by scheduler');
    await this.syncService.syncAllPages();
  }
}