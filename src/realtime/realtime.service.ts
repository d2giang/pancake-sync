import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { RealtimeEventPayload } from './dto/realtime-event.dto';

type EmitPayload = Omit<RealtimeEventPayload, 'event'>;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  emitMessageCreated(payload: EmitPayload & { message_id?: string }): void {
    this.emit(payload.page_id, payload.conversation_id, 'message.created', {
      ...payload,
      event: 'message.created',
    });
  }

  emitMessageUpdated(payload: EmitPayload & { message_id?: string }): void {
    this.emit(payload.page_id, payload.conversation_id, 'message.updated', {
      ...payload,
      event: 'message.updated',
    });
  }

  emitConversationUpdated(payload: EmitPayload): void {
    this.emit(payload.page_id, payload.conversation_id, 'conversation.updated', {
      ...payload,
      event: 'conversation.updated',
    });
  }

  emitConversationAssigned(payload: EmitPayload): void {
    this.emit(payload.page_id, payload.conversation_id, 'conversation.assigned', {
      ...payload,
      event: 'conversation.assigned',
    });
  }

  emitConversationRead(payload: EmitPayload): void {
    this.emit(payload.page_id, payload.conversation_id, 'conversation.read', {
      ...payload,
      event: 'conversation.read',
    });
  }

  private emit(
    pageId: string,
    conversationId: string,
    eventName: string,
    payload: RealtimeEventPayload,
  ): void {
    if (!this.server) {
      this.logger.warn(`Socket server not ready, skipping emit: ${eventName}`);
      return;
    }

    const rooms: string[] = [];
    if (pageId) rooms.push(`page:${pageId}`);
    if (conversationId) rooms.push(`conversation:${conversationId}`);

    if (rooms.length === 0) return;

    for (const room of rooms) {
      this.server.to(room).emit(eventName, payload);
    }

    this.logger.log(
      `Socket emitted: ${eventName} rooms=[${rooms.join(', ')}]`,
    );
  }
}
