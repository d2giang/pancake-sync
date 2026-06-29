// ============================================================
// Pancake Module — Shared Interfaces & Types
// ============================================================

// --- Pancake API Response Types ---

export interface PancakeConversation {
  id: string;
  conversation_id: string;
  page_id: string;
  customer_id?: string;
  customer_name?: string;
  customer_fb_id?: string;
  customer_psid?: string;
  type?: string;
  snippet?: string;
  seen?: boolean;
  is_replied?: boolean;
  can_inbox?: boolean;
  has_phone?: boolean;
  message_count?: number;
  last_sent_by?: PancakeLastSentBy;
  last_message_at?: string;
  last_message_from?: string;
  last_customer_message_at?: string;
  last_page_message_at?: string;
  last_admin_message_at?: string;
  last_bot_message_at?: string;
  read_watermark_at?: string | null;
  tags?: PancakeTag[];
  assignee_ids?: string[];
  current_assign_users?: PancakeAssignUser[];
  updated_at?: string;
  created_at?: string;
  [key: string]: any;
}

export interface PancakeLastSentBy {
  id?: string;
  name?: string;
  type?: string;
  admin_id?: string;
  admin_name?: string;
  app_id?: string;
  flow_id?: string;
  [key: string]: any;
}

export interface PancakeTag {
  id: string;
  name: string;
  [key: string]: any;
}

export interface PancakeAssignUser {
  id: string;
  name?: string;
  [key: string]: any;
}

export interface PancakeMessage {
  id?: string;
  message_id?: string;
  conversation_id?: string;
  from?: PancakeMessageFrom;
  to?: PancakeMessageTo;
  message?: string;
  attachments?: any[];
  sticker?: any;
  created_time?: string;
  is_echo?: boolean;
  is_automated?: boolean;
  ai_generated?: boolean;
  app_id?: string;
  flow_id?: string;
  admin_id?: string;
  admin_name?: string;
  [key: string]: any;
}

export interface PancakeMessageFrom {
  id: string;
  name?: string;
  [key: string]: any;
}

export interface PancakeMessageTo {
  id: string;
  [key: string]: any;
}

// --- Messaging Webhook Payload ---

export interface PancakeMessagingWebhookPayload {
  page_id: string;
  event_type: 'messaging' | string;
  data: {
    conversation: PancakeConversation;
    message: PancakeMessage;
    post: any | null;
  };
}

// --- Sender Types ---

export type SenderType = 'customer' | 'page' | 'admin' | 'bot' | 'unknown';

// --- Conversation Summary (Normalized) ---

export interface ConversationSummary {
  conversation_id: string;
  page_id: string;
  customer_name: string;
  customer_fb_id: string;
  customer_id: string;
  type: string;
  snippet: string;
  seen: boolean;
  is_replied: boolean;
  can_inbox: boolean;
  has_phone: boolean;
  message_count: number;
  last_sent_by: Record<string, any>;
  last_message_at: string;
  last_message_from: SenderType;
  last_customer_message_at: string | null;
  last_page_message_at: string | null;
  last_admin_message_at: string | null;
  last_bot_message_at: string | null;
  last_outbound_message_at: string | null;
  customer_message_count: number;
  page_message_count: number;
  admin_message_count: number;
  bot_message_count: number;
  has_customer_replied_after_page: boolean;
  has_page_replied_after_customer: boolean;
  read_watermark_at: string | null;
  tags: { id: string; name: string }[];
  assignee_ids: string[];
  current_assign_users: { id: string; name?: string }[];
  raw_conversation_data: PancakeConversation;
}

// --- Normalized Message ---

export interface NormalizedMessage {
  message_id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string;
  sender_name: string;
  message_text: string;
  attachments: any[];
  sticker: any | null;
  created_time: string;
  is_echo: boolean;
  is_automated: boolean;
  ai_generated: boolean;
  app_id: string | null;
  flow_id: string | null;
  admin_id: string | null;
  admin_name: string | null;
  raw_message_data: PancakeMessage;
}

// --- Laravel Forward Payloads ---

export interface LaravelForwardPayload {
  event_version: string;
  event: string;
  action: string;
  occurred_at: string;
  page_id: string;
  conversation_id: string;
  [key: string]: any;
}

export interface LaravelMessagingPayload extends LaravelForwardPayload {
  conversation_summary: ConversationSummary;
  message: NormalizedMessage;
  raw_conversation_data: PancakeConversation;
  raw_message_data: PancakeMessage;
}

export interface LaravelConversationSyncPayload extends LaravelForwardPayload {
  conversation_summary: ConversationSummary;
  raw_conversation_data: PancakeConversation;
}

export interface LaravelNoResponsePayload {
  event_version: string;
  event: string;
  action: 'no_response_1w' | 'no_response_1m';
  occurred_at: string;
  conversation_id: string;
  pancake_page_id: string;
  facebook_id: string;
  pancake_customer_id: string;
  status_code: number;
  status_label: string;
  idempotency_key: string;
  metrics: {
    last_message_from: string;
    last_message_at: string;
    last_customer_message_at: string | null;
    last_outbound_message_at: string;
    days_since_last_outbound_message: number;
  };
}

// --- Internal API DTOs ---

export interface SendMessageDto {
  page_id: string;
  conversation_id: string;
  message?: string;
  content_ids?: string[];
}

export interface TagActionDto {
  page_id: string;
  conversation_id: string;
  action: 'add' | 'remove';
  tag_id: string;
}

export interface AssignDto {
  page_id: string;
  conversation_id: string;
  assignee_ids: string[];
}

export interface ReadUnreadDto {
  page_id: string;
  conversation_id: string;
}

// --- Page Token Config ---

export interface PageTokenConfig {
  [pageId: string]: string;
}

// --- Local Cache Types ---

export interface CachedConversation {
  conversation_id: string;
  page_id: string;
  summary: ConversationSummary;
  updated_at: string;
}

export interface NoResponseEventRecord {
  conversation_id: string;
  action: 'no_response_1w' | 'no_response_1m';
  sent_at: string;
  idempotency_key: string;
  last_outbound_message_at: string;
}

export interface NoResponseCache {
  [conversationId: string]: {
    no_response_1w_sent_at?: string;
    no_response_1m_sent_at?: string;
    last_no_response_1w_idempotency_key?: string;
    last_no_response_1m_idempotency_key?: string;
  };
}

// --- Sync Result ---

export interface SyncResult {
  total_fetched: number;
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// --- Pancake API Response ---

export interface PancakeApiResponse<T = any> {
  success?: boolean;
  data?: T;
  entries?: T[];
  meta?: {
    total?: number;
    page?: number;
    per_page?: number;
  };
  [key: string]: any;
}