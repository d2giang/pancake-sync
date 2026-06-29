import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PancakeConversationActionService } from '../services/pancake-conversation-action.service';
import { PancakeConversationSyncService } from '../services/pancake-conversation-sync.service';
import {
  SendMessageDto,
  TagActionDto,
  AssignDto,
  ReadUnreadDto,
} from '../dto/pancake-internal.dto';

@Controller('internal/pancake/conversations')
export class PancakeInternalController {
  private readonly logger = new Logger(PancakeInternalController.name);

  constructor(
    private readonly actionService: PancakeConversationActionService,
    private readonly syncService: PancakeConversationSyncService,
  ) {}

  /**
   * Verify X-Internal-Secret header.
   */
  private verifySecret(headers: Record<string, string>) {
    const secret = (process.env.INTERNAL_API_SECRET || '').trim();
    const provided = (headers['x-internal-secret'] || '').trim();

    if (!secret) {
      this.logger.warn(
        'INTERNAL_API_SECRET not configured. Accepting all requests (insecure!).',
      );
      return;
    }

    if (!provided || provided !== secret) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * POST /internal/pancake/conversations/:conversationId/messages/send
   */
  @Post(':conversationId/messages/send')
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @Headers() headers: Record<string, string>,
  ) {
    this.verifySecret(headers);

    // Validate mutual exclusion
    const error = SendMessageDto.validateMutualExclusion(dto);
    if (error) {
      throw new HttpException(error, HttpStatus.BAD_REQUEST);
    }

    // Override conversation_id from URL param
    dto.conversation_id = conversationId;

    try {
      const result = await this.actionService.sendMessage(dto);
      return { success: true, data: result };
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to send message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /internal/pancake/conversations/:conversationId/tags
   */
  @Post(':conversationId/tags')
  async setTag(
    @Param('conversationId') conversationId: string,
    @Body() dto: TagActionDto,
    @Headers() headers: Record<string, string>,
  ) {
    this.verifySecret(headers);

    if (!['add', 'remove'].includes(dto.action)) {
      throw new HttpException(
        'action must be "add" or "remove"',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!dto.tag_id || !dto.tag_id.trim()) {
      throw new HttpException('tag_id is required', HttpStatus.BAD_REQUEST);
    }

    dto.conversation_id = conversationId;

    try {
      const result = await this.actionService.setTag(
        dto.page_id,
        conversationId,
        dto.action,
        dto.tag_id,
      );
      return { success: true, data: result };
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to set tag',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /internal/pancake/conversations/:conversationId/assign
   */
  @Post(':conversationId/assign')
  async assign(
    @Param('conversationId') conversationId: string,
    @Body() dto: AssignDto,
    @Headers() headers: Record<string, string>,
  ) {
    this.verifySecret(headers);

    if (!Array.isArray(dto.assignee_ids) || dto.assignee_ids.length === 0) {
      throw new HttpException(
        'assignee_ids must be a non-empty array',
        HttpStatus.BAD_REQUEST,
      );
    }

    dto.conversation_id = conversationId;

    try {
      const result = await this.actionService.assign(
        dto.page_id,
        conversationId,
        dto.assignee_ids,
      );
      return { success: true, data: result };
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to assign conversation',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /internal/pancake/conversations/:conversationId/read
   */
  @Post(':conversationId/read')
  async markRead(
    @Param('conversationId') conversationId: string,
    @Body() dto: ReadUnreadDto,
    @Headers() headers: Record<string, string>,
  ) {
    this.verifySecret(headers);

    if (!dto.page_id || !conversationId) {
      throw new HttpException(
        'page_id and conversation_id are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.actionService.markRead(
        dto.page_id,
        conversationId,
      );
      return { success: true, data: result };
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to mark read',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /internal/pancake/conversations/:conversationId/unread
   */
  @Post(':conversationId/unread')
  async markUnread(
    @Param('conversationId') conversationId: string,
    @Body() dto: ReadUnreadDto,
    @Headers() headers: Record<string, string>,
  ) {
    this.verifySecret(headers);

    if (!dto.page_id || !conversationId) {
      throw new HttpException(
        'page_id and conversation_id are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.actionService.markUnread(
        dto.page_id,
        conversationId,
      );
      return { success: true, data: result };
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to mark unread',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * POST /internal/pancake/conversations/:conversationId/sync
   */
  @Post(':conversationId/sync')
  async syncConversation(
    @Param('conversationId') conversationId: string,
    @Body() dto: ReadUnreadDto,
    @Headers() headers: Record<string, string>,
  ) {
    this.verifySecret(headers);

    if (!dto.page_id || !conversationId) {
      throw new HttpException(
        'page_id and conversation_id are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.syncService.syncSingleConversation(
        dto.page_id,
        conversationId,
      );

      return { success: result.success, data: result.summary || null };
    } catch (err: any) {
      throw new HttpException(
        err.message || 'Failed to sync conversation',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}