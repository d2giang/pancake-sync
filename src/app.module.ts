import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BroadcastModule } from './broadcast/broadcast.module';
import { WebhookModule } from './webhook/webhook.module';
import { PancakeModule } from './pancake/pancake.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BroadcastModule,
    WebhookModule,
    PancakeModule,
  ],
})
export class AppModule {}
