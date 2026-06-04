import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BroadcastModule } from './broadcast/broadcast.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BroadcastModule,
    WebhookModule,
  ],
})
export class AppModule {}
