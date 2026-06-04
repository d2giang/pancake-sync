import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BroadcastService } from './broadcast.service';

type BroadcastPayload = {
  event?: string;
  data?: unknown;
};

@Controller()
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  @Get('events')
  listen(@Res() response: Response) {
    const clientId = this.broadcastService.addClient(response);

    response.on('close', () => {
      this.broadcastService.removeClient(clientId);
    });
  }

  @Post('broadcast')
  broadcast(@Body() payload: BroadcastPayload = {}) {
    return this.broadcastService.broadcast(payload.event || 'message', {
      ...((payload.data && typeof payload.data === 'object'
        ? payload.data
        : { value: payload.data }) as Record<string, unknown>),
      broadcasted_at: new Date().toISOString(),
    });
  }
}
