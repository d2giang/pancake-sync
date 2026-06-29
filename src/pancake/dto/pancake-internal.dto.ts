import {
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  IsNotEmpty,
  ValidateIf,
  ArrayNotEmpty,
} from 'class-validator';

/**
 * DTO for POST /internal/pancake/conversations/:conversationId/messages/send
 */
export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  page_id!: string;

  @IsString()
  @IsNotEmpty()
  conversation_id!: string;

  @ValidateIf((o: SendMessageDto) => !o.content_ids || o.content_ids.length === 0)
  @IsString()
  @IsNotEmpty({ message: 'message is required when content_ids is not provided' })
  message?: string;

  @ValidateIf((o: SendMessageDto) => !o.message || o.message.trim() === '')
  @IsArray({ message: 'content_ids must be an array' })
  @ArrayNotEmpty({ message: 'content_ids is required when message is not provided' })
  content_ids?: string[];

  // Custom validation: message and content_ids are mutually exclusive
  static validateMutualExclusion(dto: SendMessageDto): string | null {
    const hasMessage = dto.message && dto.message.trim().length > 0;
    const hasContentIds =
      Array.isArray(dto.content_ids) && dto.content_ids.length > 0;

    if (hasMessage && hasContentIds) {
      return 'message and content_ids are mutually exclusive. Provide only one.';
    }

    if (!hasMessage && !hasContentIds) {
      return 'Either message or content_ids is required.';
    }

    return null;
  }
}

/**
 * DTO for POST /internal/pancake/conversations/:conversationId/tags
 */
export class TagActionDto {
  @IsString()
  @IsNotEmpty()
  page_id!: string;

  @IsString()
  @IsNotEmpty()
  conversation_id!: string;

  @IsString()
  @IsIn(['add', 'remove'], {
    message: 'action must be "add" or "remove"',
  })
  action!: 'add' | 'remove';

  @IsString()
  @IsNotEmpty({ message: 'tag_id is required' })
  tag_id!: string;
}

/**
 * DTO for POST /internal/pancake/conversations/:conversationId/assign
 */
export class AssignDto {
  @IsString()
  @IsNotEmpty()
  page_id!: string;

  @IsString()
  @IsNotEmpty()
  conversation_id!: string;

  @IsArray({ message: 'assignee_ids must be an array' })
  @ArrayNotEmpty({ message: 'assignee_ids must not be empty' })
  assignee_ids!: string[];
}

/**
 * DTO for POST /internal/pancake/conversations/:conversationId/read
 * and /internal/pancake/conversations/:conversationId/unread
 */
export class ReadUnreadDto {
  @IsString()
  @IsNotEmpty()
  page_id!: string;

  @IsString()
  @IsNotEmpty()
  conversation_id!: string;
}