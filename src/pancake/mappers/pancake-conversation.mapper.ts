import {
  ConversationSummary,
  PancakeConversation,
  SenderType,
} from '../interfaces/pancake.interface';

/**
 * Normalize a Pancake conversation into ConversationSummary.
 * This computes derived fields (last_*_message_at, message counts, etc.)
 * from summary-level data and raw conversation data.
 */
export function mapConversationToSummary(
  conversation: PancakeConversation,
  knownPageId?: string,
): ConversationSummary {
  const raw = conversation || {};

  // Extract basic identity fields
  const firstCustomer = Array.isArray(raw.customers) && raw.customers.length > 0
    ? raw.customers[0]
    : null;
  // Prefer the page ID already known from the request context (matched
  // against PANCAKE_PAGES) over the raw conversation's own `page_id` field —
  // some platforms (tiktok/zalo/threads/instagram) don't reliably echo it
  // back in the nested conversation object.
  const pageId = String(knownPageId || raw.page_id || '');
  const conversationId = String(raw.conversation_id || raw.id || '');
  // Real API shape (confirmed): no `customer_name`/`facebook_id` fields —
  // customer identity lives in `from` (the message sender) and `customers[]`.
  const customerName = String(raw.customer_name || raw.from?.name || firstCustomer?.name || '');
  const customerFbId = String(
    raw.customer_fb_id || raw.facebook_id || raw.customer_psid || raw.from?.id || firstCustomer?.fb_id || '',
  );
  const customerId = String(raw.customer_id || firstCustomer?.id || '');
  const type = String(raw.type || 'INBOX');
  const snippet = String(raw.snippet || '');
  const seen = !!raw.seen;
  const isReplied = !!raw.is_replied;
  const canInbox = raw.can_inbox !== false;
  const hasPhone = !!raw.has_phone;
  const messageCount = Number(raw.message_count || 0);

  // Last sent by
  const lastSentBy = raw.last_sent_by && typeof raw.last_sent_by === 'object'
    ? { ...raw.last_sent_by }
    : {};

  // Timestamps
  // `last_message_at` doesn't exist on the real API response — fall back to
  // `updated_at` (confirmed present), which tracks the conversation's last
  // activity. The granular last_customer/page/admin/bot_message_at fields
  // below are NOT confirmed present on this endpoint; left as best-effort.
  const lastMessageAt = String(raw.last_message_at || raw.updated_at || '');
  const lastCustomerMessageAt = raw.last_customer_message_at
    ? String(raw.last_customer_message_at)
    : null;
  const lastPageMessageAt = raw.last_page_message_at
    ? String(raw.last_page_message_at)
    : null;
  const lastAdminMessageAt = raw.last_admin_message_at
    ? String(raw.last_admin_message_at)
    : null;
  const lastBotMessageAt = raw.last_bot_message_at
    ? String(raw.last_bot_message_at)
    : null;

  // Computed: last outbound = max(page, admin, bot)
  const outboundDates = [lastPageMessageAt, lastAdminMessageAt, lastBotMessageAt]
    .filter((d): d is string => !!d)
    .sort();
  const lastOutboundMessageAt = outboundDates.length > 0
    ? outboundDates[outboundDates.length - 1]
    : null;

  // Last message from: derive from last_sent_by or timestamps
  let lastMessageFrom: SenderType = 'unknown';
  if (lastSentBy.type) {
    const t = String(lastSentBy.type).toLowerCase();
    if (t === 'customer' || t === 'user') lastMessageFrom = 'customer';
    else if (t === 'admin') lastMessageFrom = 'admin';
    else if (t === 'bot' || t === 'automated') lastMessageFrom = 'bot';
    else if (t === 'page') lastMessageFrom = 'page';
    else lastMessageFrom = 'page'; // default fallback
  } else if (raw.last_message_from) {
    const from = String(raw.last_message_from).toLowerCase();
    if (from === 'customer' || from === 'user') lastMessageFrom = 'customer';
    else if (from === 'admin') lastMessageFrom = 'admin';
    else if (from === 'bot') lastMessageFrom = 'bot';
    else lastMessageFrom = 'page';
  }

  // Message counts by sender type
  const customerMessageCount = Number(raw.customer_message_count || 0);
  const pageMessageCount = Number(raw.page_message_count || 0);
  const adminMessageCount = Number(raw.admin_message_count || 0);
  const botMessageCount = Number(raw.bot_message_count || 0);

  // Has replied flags
  const hasCustomerRepliedAfterPage = !!(raw.has_customer_replied_after_page);
  const hasPageRepliedAfterCustomer = !!(raw.has_page_replied_after_customer);

  // Read watermark
  const readWatermarkAt = raw.read_watermark_at
    ? String(raw.read_watermark_at)
    : null;

  // Tags — real API: array can contain `null` entries, and the label field
  // is `text`, not `name`.
  const tags: { id: string; name: string }[] = Array.isArray(raw.tags)
    ? raw.tags
        .filter((tag: any) => tag != null)
        .map((tag: any) => ({
          id: String(tag?.id || ''),
          name: String(tag?.text || tag?.name || ''),
        }))
    : [];

  // Assignee
  const assigneeIds: string[] = Array.isArray(raw.assignee_ids)
    ? raw.assignee_ids.map((id: any) => String(id))
    : [];

  const currentAssignUsers: { id: string; name?: string }[] = Array.isArray(
    raw.current_assign_users,
  )
    ? raw.current_assign_users.map((user: any) => ({
        id: String(user?.id || ''),
        name: user?.name ? String(user.name) : undefined,
      }))
    : [];

  return {
    conversation_id: conversationId,
    page_id: pageId,
    customer_name: customerName,
    customer_fb_id: customerFbId,
    customer_id: customerId,
    type,
    snippet,
    seen,
    is_replied: isReplied,
    can_inbox: canInbox,
    has_phone: hasPhone,
    message_count: messageCount,
    last_sent_by: lastSentBy,
    last_message_at: lastMessageAt,
    last_message_from: lastMessageFrom,
    last_customer_message_at: lastCustomerMessageAt,
    last_page_message_at: lastPageMessageAt,
    last_admin_message_at: lastAdminMessageAt,
    last_bot_message_at: lastBotMessageAt,
    last_outbound_message_at: lastOutboundMessageAt,
    customer_message_count: customerMessageCount,
    page_message_count: pageMessageCount,
    admin_message_count: adminMessageCount,
    bot_message_count: botMessageCount,
    has_customer_replied_after_page: hasCustomerRepliedAfterPage,
    has_page_replied_after_customer: hasPageRepliedAfterCustomer,
    read_watermark_at: readWatermarkAt,
    tags,
    assignee_ids: assigneeIds,
    current_assign_users: currentAssignUsers,
    raw_conversation_data: raw,
  };
}