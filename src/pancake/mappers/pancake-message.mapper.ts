import { NormalizedMessage, PancakeMessage } from '../interfaces/pancake.interface';
import { classifySender } from '../utils/sender-classifier';

/**
 * Normalize a Pancake message from messaging webhook.
 * Requires pageId to determine sender type.
 */
export function mapMessageToNormalized(
  message: PancakeMessage,
  pageId: string,
): NormalizedMessage {
  const raw = message || {};

  const senderId = String(raw.from?.id || '');
  const senderName = String(raw.from?.name || '');
  const messageId = String(raw.message_id || raw.id || '');
  const conversationId = String(raw.conversation_id || '');
  const createdTime = String(raw.created_time || '');
  const messageText = String(raw.message || '');
  const attachments: any[] = Array.isArray(raw.attachments) ? raw.attachments : [];
  const sticker = raw.sticker || null;
  const isEcho = !!raw.is_echo;
  const isAutomated = !!(raw.is_automated || raw.ai_generated);
  const aiGenerated = !!raw.ai_generated;
  const appId = raw.app_id ? String(raw.app_id) : null;
  const flowId = raw.flow_id ? String(raw.flow_id) : null;
  const adminId = raw.admin_id ? String(raw.admin_id) : null;
  const adminName = raw.admin_name ? String(raw.admin_name) : null;

  const senderType = classifySender(raw, pageId);

  return {
    message_id: messageId,
    conversation_id: conversationId,
    sender_type: senderType,
    sender_id: senderId,
    sender_name: senderName,
    message_text: messageText,
    attachments,
    sticker,
    created_time: createdTime,
    is_echo: isEcho,
    is_automated: isAutomated,
    ai_generated: aiGenerated,
    app_id: appId,
    flow_id: flowId,
    admin_id: adminId,
    admin_name: adminName,
    raw_message_data: raw,
  };
}