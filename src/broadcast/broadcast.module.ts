import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';

@Module({
  controllers: [BroadcastController],
  providers: [BroadcastService],
})
export class BroadcastModule {}
