import { ConversationSummary, NormalizedMessage } from '../interfaces/pancake.interface';

/**
 * Flatten a ConversationSummary into the exact field names
 * CandidateConversationSyncService::mapConversationData() (Laravel) reads.
 * Laravel reads these as top-level keys, not nested under `conversation_summary`.
 *
 * Deliberately excludes `raw_conversation_data` — it includes
 * tag_histories/assignee_histories, which grow unbounded over a
 * conversation's lifetime. This helper is also used on the real-time
 * per-message webhook path (pancake-webhook.controller.ts), so including the
 * full raw blob there would mean re-sending months of history on every
 * single incoming message. Callers that do a deliberate full conversation
 * sync (pancake-conversation-sync.service.ts) add raw_conversation_data
 * themselves, separately.
 */
export function buildLaravelConversationFields(
  summary: ConversationSummary,
): Record<string, any> {
  return {
    pancake_conversation_id: summary.conversation_id,
    conversation_id: summary.conversation_id,
    pancake_page_id: summary.page_id,
    page_id: summary.page_id,
    pancake_customer_id: summary.customer_id,
    customer_id: summary.customer_id,
    facebook_id: summary.customer_fb_id,
    customer_name: summary.customer_name,
    type: summary.type,
    snippet: summary.snippet,
    seen: summary.seen,
    is_replied: summary.is_replied,
    can_inbox: summary.can_inbox,
    has_phone: summary.has_phone,
    message_count: summary.message_count,
    last_sent_by_id: summary.last_sent_by?.id ?? null,
    last_sent_by_name: summary.last_sent_by?.name ?? null,
    last_sent_by_admin_id: summary.last_sent_by?.admin_id ?? null,
    last_sent_by_admin_name: summary.last_sent_by?.admin_name ?? null,
    last_message_at: summary.last_message_at,
    last_message_from: summary.last_message_from,
    last_customer_message_at: summary.last_customer_message_at,
    last_page_message_at: summary.last_page_message_at,
    last_admin_message_at: summary.last_admin_message_at,
    last_bot_message_at: summary.last_bot_message_at,
    last_outbound_message_at: summary.last_outbound_message_at,
    customer_message_count: summary.customer_message_count,
    page_message_count: summary.page_message_count,
    admin_message_count: summary.admin_message_count,
    bot_message_count: summary.bot_message_count,
    has_customer_replied_after_page: summary.has_customer_replied_after_page,
    has_page_replied_after_customer: summary.has_page_replied_after_customer,
    read_watermark_at: summary.read_watermark_at,
    assignee_ids: summary.assignee_ids,
    current_assign_users: summary.current_assign_users,
    tags: summary.tags,
    // Laravel has a dedicated `tag_histories` column, but the raw array
    // grows forever (months of tag add/remove events) — cap it so the
    // column doesn't grow unbounded for old/active conversations.
    tag_histories: Array.isArray(summary.raw_conversation_data?.tag_histories)
      ? summary.raw_conversation_data.tag_histories.slice(0, 20)
      : null,
  };
}

/**
 * Strip fields from the raw conversation object that are unbounded
 * (grow forever) and unused by Laravel — currently just
 * `assignee_histories`, which has no corresponding Laravel column.
 * `tag_histories` is handled separately via buildLaravelConversationFields
 * (capped, sent as its own field) so it's stripped here too to avoid
 * storing it twice.
 */
export function trimRawConversationData<T extends Record<string, any>>(raw: T): T {
  const { assignee_histories, tag_histories, ...rest } = raw || ({} as T);
  return rest as T;
}

/**
 * Flatten a NormalizedMessage into the exact field names
 * CandidateMessageSyncService::mapMessageData() (Laravel) reads.
 */
export function buildLaravelMessageFields(
  pageId: string,
  conversationId: string,
  message: NormalizedMessage,
): Record<string, any> {
  return {
    pancake_message_id: message.message_id,
    pancake_conversation_id: conversationId,
    conversation_id: conversationId,
    pancake_page_id: pageId,
    page_id: pageId,
    sender_type: message.sender_type,
    sender_id: message.sender_id,
    sender_name: message.sender_name,
    message_type: message.attachments?.length ? 'attachment' : 'text',
    message: message.message_text,
    message_text: message.message_text,
    attachments: message.attachments,
    is_hidden: false,
    is_removed: false,
    inserted_at: message.created_time,
    inserted_at_pancake: message.created_time,
    raw_message_data: message.raw_message_data,
  };
}
