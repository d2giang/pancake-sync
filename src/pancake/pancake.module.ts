import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RealtimeModule } from '../realtime/realtime.module';
import { validateEnv } from './utils/env-validator';

// Controllers
import { PancakeInternalController } from './controllers/pancake-internal.controller';
import { PancakeSyncController } from './controllers/pancake-sync.controller';

// Services
import { LocalCacheService } from './services/local-cache.service';
import { PancakeApiService } from './services/pancake-api.service';
import { PancakeWebhookForwardService } from './services/pancake-webhook-forward.service';
import { PancakeConversationActionService } from './services/pancake-conversation-action.service';
import { PancakeConversationSyncService } from './services/pancake-conversation-sync.service';
import { NoResponseDetectorService } from './services/no-response-detector.service';

// Schedulers
import { ConversationSyncScheduler } from './schedulers/conversation-sync.scheduler';
import { NoResponseScheduler } from './schedulers/no-response.scheduler';

@Module({
  imports: [ScheduleModule.forRoot(), RealtimeModule],
  controllers: [PancakeInternalController, PancakeSyncController],
  providers: [
    LocalCacheService,
    PancakeApiService,
    PancakeWebhookForwardService,
    PancakeConversationActionService,
    PancakeConversationSyncService,
    NoResponseDetectorService,
    ConversationSyncScheduler,
    NoResponseScheduler,
  ],
  exports: [
    PancakeApiService,
    PancakeWebhookForwardService,
    PancakeConversationActionService,
    PancakeConversationSyncService,
    LocalCacheService,
  ],
})
export class PancakeModule implements OnModuleInit {
  private readonly logger = new Logger(PancakeModule.name);

  onModuleInit() {
    this.logger.log('Pancake module initialized. Validating environment…');
    validateEnv();
  }
}
