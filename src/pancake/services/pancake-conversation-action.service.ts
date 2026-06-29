import { Injectable, Logger } from '@nestjs/common';
import { PancakeApiService } from './pancake-api.service';
import { SendMessageDto } from '../dto/pancake-internal.dto';

@Injectable()
export class PancakeConversationActionService {
  private readonly logger = new Logger(PancakeConversationActionService.name);

  constructor(private readonly pancakeApi: PancakeApiService) {}

  /**
   * Send a message to a Pancake conversation.
   * Validates mutual exclusion of message/content_ids.
   */
  async sendMessage(dto: SendMessageDto) {
    const error = SendMessageDto.validateMutualExclusion(dto);
    if (error) {
      throw new Error(error);
    }

    return this.pancakeApi.sendMessage(
      dto.page_id,
      dto.conversation_id,
      {
        message: dto.message,
        content_ids: dto.content_ids,
      },
    );
  }

  /**
   * Add or remove a tag from a conversation.
   */
  async setTag(
    pageId: string,
    conversationId: string,
    action: 'add' | 'remove',
    tagId: string,
  ) {
    if (!['add', 'remove'].includes(action)) {
      throw new Error('action must be "add" or "remove"');
    }

    if (!tagId || !tagId.trim()) {
      throw new Error('tag_id is required');
    }

    return this.pancakeApi.setConversationTag(
      pageId,
      conversationId,
      action,
      tagId,
    );
  }

  /**
   * Assign a conversation to assignee(s).
   */
  async assign(
    pageId: string,
    conversationId: string,
    assigneeIds: string[],
  ) {
    if (!Array.isArray(assigneeIds) || assigneeIds.length === 0) {
      throw new Error('assignee_ids must be a non-empty array');
    }

    return this.pancakeApi.assignConversation(
      pageId,
      conversationId,
      assigneeIds,
    );
  }

  /**
   * Mark a conversation as read.
   */
  async markRead(pageId: string, conversationId: string) {
    if (!pageId || !conversationId) {
      throw new Error('page_id and conversation_id are required');
    }

    return this.pancakeApi.markRead(pageId, conversationId);
  }

  /**
   * Mark a conversation as unread.
   */
  async markUnread(pageId: string, conversationId: string) {
    if (!pageId || !conversationId) {
      throw new Error('page_id and conversation_id are required');
    }

    return this.pancakeApi.markUnread(pageId, conversationId);
  }
}