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

    // Token present — accept connection immediately to avoid the race condition
    // where async verification closes the socket while the WS handshake is still
    // in progress ("closed before established").
    // Fine-grained authorization (verify token against Laravel GET /api/me) is
    // handled lazily in handleJoinPage / handleJoinConversation when it matters.
    this.logger.log(`Socket connected: id=${client.id}`);
  }

  /**
   * Verify a Bearer token against Laravel GET /api/me.
   * Called before allowing a client to join a room.
   * Returns true if valid, false on 401/403/network error.
   */
  private async verifyToken(token: string): Promise<boolean> {
    const base = getLaravelApiBaseUrl();
    if (!base) return true; // Dev fallback — no Laravel URL configured.
    try {
      await axios.get(`${base}/me`, {
        headers: { Authorization: token },
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket disconnected: id=${client.id}`);
  }

  @SubscribeMessage('join_page')
  async handleJoinPage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { page_id: string },
  ): Promise<{ event: string; data: unknown }> {
    const token = client.handshake.auth?.token as string;
    if (!(await this.verifyToken(token))) {
      client.disconnect(true);
      return { event: 'error', data: { reason: 'unauthorized' } };
    }
    const pageId = String(data?.page_id || '').trim();
    if (!pageId)
      return { event: 'error', data: { reason: 'page_id_required' } };
    const room = `page:${pageId}`;
    client.join(room);
    const sockets = this.server.sockets.adapter.rooms.get(room)?.size || 0;
    this.logger.log(
      `Socket room joined: ${room} sockets=${sockets} (id=${client.id})`,
    );
    return { event: 'joined', data: { room, sockets } };
  }

  @SubscribeMessage('leave_page')
  handleLeavePage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { page_id: string },
  ): { event: string; data: { room: string } } {
    const room = `page:${data?.page_id}`;
    client.leave(room);
    return { event: 'left', data: { room } };
  }

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversation_id: string },
  ): Promise<{ event: string; data: unknown }> {
    const token = client.handshake.auth?.token as string;
    if (!(await this.verifyToken(token))) {
      client.disconnect(true);
      return { event: 'error', data: { reason: 'unauthorized' } };
    }
    const conversationId = String(data?.conversation_id || '').trim();
    if (!conversationId) {
      return { event: 'error', data: { reason: 'conversation_id_required' } };
    }
    const room = `conversation:${conversationId}`;
    client.join(room);
    const sockets = this.server.sockets.adapter.rooms.get(room)?.size || 0;
    this.logger.log(
      `Socket room joined: ${room} sockets=${sockets} (id=${client.id})`,
    );
    return { event: 'joined', data: { room, sockets } };
  }

  @SubscribeMessage('leave_conversation')
  handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversation_id: string },
  ): { event: string; data: { room: string } } {
    const room = `conversation:${data?.conversation_id}`;
    client.leave(room);
    return { event: 'left', data: { room } };
  }
}
