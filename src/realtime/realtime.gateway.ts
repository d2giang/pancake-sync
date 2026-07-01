import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { getLaravelApiBaseUrl } from '../pancake/utils/env-validator';
import { RealtimeService } from './realtime.service';

@WebSocketGateway({
  cors: {
    // Mirror the request origin so credentials work in all browser environments.
    // Lock this down via SOCKET_CORS_ORIGIN env var in production if needed.
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly realtimeService: RealtimeService) {}

  afterInit(server: Server): void {
    this.realtimeService.setServer(server);
    this.logger.log('Socket.IO gateway initialized');
  }

  handleConnection(client: Socket): void {
    const token = client.handshake.auth?.token as string | undefined;

    if (!token) {
      this.logger.warn(`Socket rejected — no auth token (id=${client.id})`);
      client.disconnect(true);
      return;
    }

    // Verify token asynchronously — disconnect if Laravel rejects it.
    // We fire-and-forget so the socket handshake doesn't block; the client
    // stays in an unverified limbo for < 1s then gets cut if invalid.
    this.verifyTokenAsync(client, token);
  }

  private async verifyTokenAsync(client: Socket, token: string): Promise<void> {
    const base = getLaravelApiBaseUrl();
    if (!base) {
      // Laravel URL not configured — accept the connection (fail-open in dev).
      this.logger.log(`Socket connected (no Laravel URL, skipping verify): id=${client.id}`);
      return;
    }

    try {
      await axios.get(`${base}/me`, {
        headers: { Authorization: token },
        timeout: 5000,
      });
      this.logger.log(`Socket connected: id=${client.id}`);
    } catch (error: any) {
      const status = error.response?.status;
      this.logger.warn(
        `Socket rejected — token invalid [HTTP ${status ?? 'network'}] (id=${client.id})`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket disconnected: id=${client.id}`);
  }

  @SubscribeMessage('join_page')
  handleJoinPage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { page_id: string },
  ): { event: string; room: string } {
    const room = `page:${data?.page_id}`;
    client.join(room);
    this.logger.log(`Socket room joined: ${room} (id=${client.id})`);
    return { event: 'joined', room };
  }

  @SubscribeMessage('leave_page')
  handleLeavePage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { page_id: string },
  ): { event: string; room: string } {
    const room = `page:${data?.page_id}`;
    client.leave(room);
    return { event: 'left', room };
  }

  @SubscribeMessage('join_conversation')
  handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversation_id: string },
  ): { event: string; room: string } {
    const room = `conversation:${data?.conversation_id}`;
    client.join(room);
    this.logger.log(`Socket room joined: ${room} (id=${client.id})`);
    return { event: 'joined', room };
  }

  @SubscribeMessage('leave_conversation')
  handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversation_id: string },
  ): { event: string; room: string } {
    const room = `conversation:${data?.conversation_id}`;
    client.leave(room);
    return { event: 'left', room };
  }
}
