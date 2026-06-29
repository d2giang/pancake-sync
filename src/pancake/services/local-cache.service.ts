import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  CachedConversation,
  ConversationSummary,
  NoResponseCache,
  NoResponseEventRecord,
} from '../interfaces/pancake.interface';

@Injectable()
export class LocalCacheService {
  private readonly logger = new Logger(LocalCacheService.name);
  private readonly baseDataPath = path.join(process.cwd(), 'data', 'webhook');

  // File paths
  private readonly conversationsPath = path.join(
    this.baseDataPath,
    'pancake-conversations.json',
  );
  private readonly messagesPath = path.join(
    this.baseDataPath,
    'pancake-messages.json',
  );
  private readonly summaryIndexPath = path.join(
    this.baseDataPath,
    'conversation-summary-index.json',
  );
  private readonly noResponseEventsPath = path.join(
    this.baseDataPath,
    'no-response-events.json',
  );
  private readonly noResponseCachePath = path.join(
    this.baseDataPath,
    'no-response-cache.json',
  );

  constructor() {
    this.ensureDataDir();
  }

  private ensureDataDir() {
    if (!fs.existsSync(this.baseDataPath)) {
      fs.mkdirSync(this.baseDataPath, { recursive: true });
    }
  }

  private readJsonFile(filePath: string): any {
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) return null;
      return JSON.parse(raw);
    } catch {
      this.logger.error(`Failed to read JSON file: ${filePath}`);
      return null;
    }
  }

  private writeJsonFile(filePath: string, data: any) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error: any) {
      this.logger.error(
        `Failed to write JSON file: ${filePath} — ${error.message}`,
      );
    }
  }

  // ---- Conversations ----

  getCachedConversations(): CachedConversation[] {
    const data = this.readJsonFile(this.conversationsPath);
    return Array.isArray(data) ? data : [];
  }

  setCachedConversations(conversations: CachedConversation[]) {
    this.writeJsonFile(this.conversationsPath, conversations);
  }

  upsertConversation(summary: ConversationSummary) {
    const records = this.getCachedConversations();
    const idx = records.findIndex(
      (c) => c.conversation_id === summary.conversation_id,
    );

    const record: CachedConversation = {
      conversation_id: summary.conversation_id,
      page_id: summary.page_id,
      summary,
      updated_at: new Date().toISOString(),
    };

    if (idx >= 0) {
      records[idx] = record;
    } else {
      records.push(record);
    }

    this.setCachedConversations(records);
  }

  getCachedConversation(
    conversationId: string,
  ): CachedConversation | undefined {
    return this.getCachedConversations().find(
      (c) => c.conversation_id === conversationId,
    );
  }

  // ---- Messages ----

  getCachedMessages(): any[] {
    const data = this.readJsonFile(this.messagesPath);
    return Array.isArray(data) ? data : [];
  }

  appendMessage(message: any) {
    const messages = this.getCachedMessages();
    messages.push({
      stored_at: new Date().toISOString(),
      ...message,
    });
    // Keep last 1000 messages
    if (messages.length > 1000) {
      messages.splice(0, messages.length - 1000);
    }
    this.writeJsonFile(this.messagesPath, messages);
  }

  // ---- Summary Index ----

  getSummaryIndex(): Record<string, any> {
    const data = this.readJsonFile(this.summaryIndexPath);
    return data && typeof data === 'object' ? data : {};
  }

  setSummaryIndex(index: Record<string, any>) {
    this.writeJsonFile(this.summaryIndexPath, index);
  }

  getSummaryIndexEntry(conversationId: string): any | null {
    const index = this.getSummaryIndex();
    return index[conversationId] || null;
  }

  setSummaryIndexEntry(conversationId: string, data: any) {
    const index = this.getSummaryIndex();
    index[conversationId] = {
      ...data,
      updated_at: new Date().toISOString(),
    };
    this.setSummaryIndex(index);
  }

  // ---- No Response Cache ----

  getNoResponseCache(): NoResponseCache {
    const data = this.readJsonFile(this.noResponseCachePath);
    return data && typeof data === 'object' ? data : {};
  }

  setNoResponseCache(cache: NoResponseCache) {
    this.writeJsonFile(this.noResponseCachePath, cache);
  }

  getNoResponseCacheEntry(conversationId: string) {
    return this.getNoResponseCache()[conversationId] || null;
  }

  setNoResponseCacheEntry(
    conversationId: string,
    entry: NoResponseCache[string],
  ) {
    const cache = this.getNoResponseCache();
    cache[conversationId] = {
      ...cache[conversationId],
      ...entry,
    };
    this.setNoResponseCache(cache);
  }

  // ---- No Response Events ----

  getNoResponseEvents(): NoResponseEventRecord[] {
    const data = this.readJsonFile(this.noResponseEventsPath);
    return Array.isArray(data) ? data : [];
  }

  appendNoResponseEvent(event: NoResponseEventRecord) {
    const events = this.getNoResponseEvents();
    events.push(event);
    // Keep last 500
    if (events.length > 500) {
      events.splice(0, events.length - 500);
    }
    this.writeJsonFile(this.noResponseEventsPath, events);
  }

  hasNoResponseEventBeenSent(
    conversationId: string,
    action: 'no_response_1w' | 'no_response_1m',
    idempotencyKey: string,
  ): boolean {
    return this.getNoResponseEvents().some(
      (e) =>
        e.conversation_id === conversationId &&
        e.action === action &&
        e.idempotency_key === idempotencyKey,
    );
  }
}