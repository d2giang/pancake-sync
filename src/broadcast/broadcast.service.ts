import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

type BroadcastClient = {
  id: number;
  response: Response;
  heartbeat: NodeJS.Timeout;
};

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly clients = new Map<number, BroadcastClient>();
  private nextClientId = 1;

  addClient(response: Response): number {
    const id = this.nextClientId++;

    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    response.write('retry: 3000\n\n');
    this.send(response, 'connected', {
      client_id: id,
      connected_clients: this.clients.size + 1,
    });

    const heartbeat = setInterval(() => {
      response.write(`: ping ${new Date().toISOString()}\n\n`);
    }, 25000);

    this.clients.set(id, { id, response, heartbeat });
    this.logger.log(`SSE client connected: ${id}`);

    return id;
  }

  removeClient(id: number) {
    const client = this.clients.get(id);
    if (!client) return;

    clearInterval(client.heartbeat);
    this.clients.delete(id);
    this.logger.log(`SSE client disconnected: ${id}`);
  }

  broadcast(event: string, data: unknown) {
    const safeEvent = event.replace(/[\r\n]/g, '').trim() || 'message';

    for (const client of this.clients.values()) {
      this.send(client.response, safeEvent, data);
    }

    return {
      success: true,
      event: safeEvent,
      delivered: this.clients.size,
    };
  }

  private send(response: Response, event: string, data: unknown) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data ?? null)}\n\n`);
  }
}
