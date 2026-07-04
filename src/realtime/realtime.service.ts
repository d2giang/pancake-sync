import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { RealtimeEventPayload } from './dto/realtime-event.dto';

type EmitPayload = Omit<RealtimeEventPayload, 'event'>;

export interface RealtimeEmitResult {
  event: string;
  rooms: Array<{ room: string; sockets: number }>;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  emitMessageCreated(
    payload: EmitPayload & { message_id?: string },
  ): RealtimeEmitResult {
    return this.emit(
      payload.page_id,
      payload.conversation_id,
      'message.created',
      {
        ...payload,
        event: 'message.created',
      },
    );
  }

  emitMessageUpdated(
    payload: EmitPayload & { message_id?: string },
  ): RealtimeEmitResult {
    return this.emit(
      payload.page_id,
      payload.conversation_id,
      'message.updated',
      {
        ...payload,
        event: 'message.updated',
      },
    );
  }

  emitConversationUpdated(payload: EmitPayload): RealtimeEmitResult {
    return this.emit(
      payload.page_id,
      payload.conversation_id,
      'conversation.updated',
      {
        ...payload,
        event: 'conversation.updated',
      },
    );
  }

  emitConversationAssigned(payload: EmitPayload): RealtimeEmitResult {
    return this.emit(
      payload.page_id,
      payload.conversation_id,
      'conversation.assigned',
      {
        ...payload,
        event: 'conversation.assigned',
      },
    );
  }

  emitConversationRead(payload: EmitPayload): RealtimeEmitResult {
    return this.emit(
      payload.page_id,
      payload.conversation_id,
      'conversation.read',
      {
        ...payload,
        event: 'conversation.read',
      },
    );
  }

  private emit(
    pageId: string,
    conversationId: string,
    eventName: string,
    payload: RealtimeEventPayload,
  ): RealtimeEmitResult {
    if (!this.server) {
      this.logger.warn(`Socket server not ready, skipping emit: ${eventName}`);
      return { event: eventName, rooms: [] };
    }
    const server = this.server;

    const rooms: string[] = [];
    if (pageId) rooms.push(`page:${pageId}`);
    if (conversationId) rooms.push(`conversation:${conversationId}`);

    if (rooms.length === 0) return { event: eventName, rooms: [] };

    const roomResults = rooms.map((room) => {
      const sockets = server.sockets.adapter.rooms.get(room)?.size || 0;
      server.to(room).emit(eventName, payload);
      this.logger.log(
        `Socket emitted event=${eventName} room=${room} sockets=${sockets} ` +
          `page_id=${payload.page_id} conversation_id=${payload.conversation_id} ` +
          `message_id=${payload.message_id || '(none)'}`,
      );
      return { room, sockets };
    });

    return { event: eventName, rooms: roomResults };
  }
}
