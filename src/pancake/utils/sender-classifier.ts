import { SenderType } from '../interfaces/pancake.interface';

/**
 * Classify who sent the message: customer, page, admin, bot, or unknown.
 *
 * Rules:
 *  - If message.from.id !== pageId → customer
 *  - If message.from.id === pageId AND one of:
 *      admin_name = 'Botcake', ai_generated=true, is_automated=true, app_id, flow_id
 *      → bot
 *  - If message.from.id === pageId AND admin_id → admin
 *  - If message.from.id === pageId → page
 *  - Else → unknown
 */
export function classifySender(message: any, pageId: string): SenderType {
  const senderId = message?.from?.id;

  if (!senderId) return 'unknown';

  // Customer: sender id is different from page id
  if (senderId !== pageId) return 'customer';

  // From this point, senderId === pageId

  // Bot detection indicators
  const adminName = message?.admin_name;
  const isAutomated =
    message?.is_automated === true ||
    message?.is_automated === 'true' ||
    message?.ai_generated === true ||
    message?.ai_generated === 'true';

  if (
    adminName === 'Botcake' ||
    message?.ai_generated === true ||
    (message?.app_id && message?.app_id !== '') ||
    (message?.flow_id && message?.flow_id !== '') ||
    isAutomated
  ) {
    return 'bot';
  }

  // Admin: has admin_id
  if (message?.admin_id && String(message.admin_id).trim() !== '') {
    return 'admin';
  }

  // Page (default outbound from page itself)
  return 'page';
}

export function isCustomerMessage(message: any, pageId: string): boolean {
  return classifySender(message, pageId) === 'customer';
}

export function isPageMessage(message: any, pageId: string): boolean {
  return classifySender(message, pageId) === 'page';
}

export function isAdminMessage(message: any, pageId: string): boolean {
  return classifySender(message, pageId) === 'admin';
}

export function isBotMessage(message: any, pageId: string): boolean {
  return classifySender(message, pageId) === 'bot';
}

export function getSenderType(message: any, pageId: string): SenderType {
  return classifySender(message, pageId);
}