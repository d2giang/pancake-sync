import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { PancakeModule } from '../pancake/pancake.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [PancakeModule, RealtimeModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
