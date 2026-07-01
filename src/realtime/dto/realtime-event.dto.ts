export interface RealtimeEventPayload {
  event: string;
  page_id: string;
  conversation_id: string;
  message_id?: string;
  timestamp: string;
  source: 'pancake' | 'meta';
}
