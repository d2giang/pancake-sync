import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  getPageToken,
  getPancakePublicApiBaseUrl,
  getPancakeApiTimeout,
} from '../utils/env-validator';
import {
  PancakeApiResponse,
  PancakeConversation,
} from '../interfaces/pancake.interface';

@Injectable()
export class PancakeApiService {
  private readonly logger = new Logger(PancakeApiService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor() {
    this.baseUrl = getPancakePublicApiBaseUrl();
    this.timeout = getPancakeApiTimeout();
  }

  /**
   * Create an Axios instance with the appropriate auth header for a given page.
   * Uses PANCAKE_PAGE_TOKENS or PANCAKE_PAGE_ID/PANCAKE_PAGE_ACCESS_TOKEN env config.
   */
  private clientForPage(pageId: string): AxiosInstance {
    const token = getPageToken(pageId);

    if (!token) {
      this.logger.warn(`No token configured for page ${pageId}`);
    }

    return axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  /**
   * Send message to a conversation.
   * Message and content_ids are mutually exclusive.
   */
  async sendMessage(
    pageId: string,
    conversationId: string,
    payload: { message?: string; content_ids?: string[] },
  ): Promise<PancakeApiResponse> {
    const client = this.clientForPage(pageId);

    try {
      const body: Record<string, any> = {};

      if (payload.message) {
        body.message = payload.message;
      } else if (payload.content_ids && payload.content_ids.length > 0) {
        body.content_ids = payload.content_ids;
      }

      const res = await client.post(
        `/v1/pages/${pageId}/conversations/${conversationId}/messages`,
        body,
      );

      // Success — no log needed (errors go to catch)

      return res.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to send message to ${conversationId} on page ${pageId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Add or remove a tag from a conversation.
   */
  async setConversationTag(
    pageId: string,
    conversationId: string,
    action: 'add' | 'remove',
    tagId: string,
  ): Promise<PancakeApiResponse> {
    const client = this.clientForPage(pageId);

    try {
      const res = await client.post(
        `/v1/pages/${pageId}/conversations/${conversationId}/tags`,
        { action, tag_id: tagId },
      );

      // Success — no log needed

      return res.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to ${action} tag ${tagId} on ${conversationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Assign a conversation to assignee(s).
   */
  async assignConversation(
    pageId: string,
    conversationId: string,
    assigneeIds: string[],
  ): Promise<PancakeApiResponse> {
    const client = this.clientForPage(pageId);

    try {
      const res = await client.post(
        `/v1/pages/${pageId}/conversations/${conversationId}/assign`,
        { assignee_ids: assigneeIds },
      );

      // Success — no log needed

      return res.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to assign ${conversationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Mark a conversation as read.
   */
  async markRead(
    pageId: string,
    conversationId: string,
  ): Promise<PancakeApiResponse> {
    const client = this.clientForPage(pageId);

    try {
      const res = await client.post(
        `/v1/pages/${pageId}/conversations/${conversationId}/read`,
      );

      // Success — no log needed

      return res.data;
    } catch (error: any) {
      this.logger.error(`Failed to mark read ${conversationId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark a conversation as unread.
   */
  async markUnread(
    pageId: string,
    conversationId: string,
  ): Promise<PancakeApiResponse> {
    const client = this.clientForPage(pageId);

    try {
      const res = await client.post(
        `/v1/pages/${pageId}/conversations/${conversationId}/unread`,
      );

      // Success — no log needed

      return res.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to mark unread ${conversationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Fetch conversations for a page (backup sync).
   * Supports pagination. Returns the raw API response.
   */
  async getConversations(
    pageId: string,
    params?: {
      limit?: number;
      before?: string;
      after?: string;
      updated_since?: string;
      updated_until?: string;
    },
  ): Promise<PancakeApiResponse<PancakeConversation[]>> {
    const client = this.clientForPage(pageId);

    try {
      const query: Record<string, any> = {};

      if (params?.limit) query.limit = params.limit;
      if (params?.before) query.before = params.before;
      if (params?.after) query.after = params.after;
      if (params?.updated_since) query.updated_since = params.updated_since;
      if (params?.updated_until) query.updated_until = params.updated_until;

      const res = await client.get(`/v2/pages/${pageId}/conversations`, {
        params: query,
      });

      // Diagnostic: log first sync to verify API connectivity
      this.logger.log(
        `Pancake conversations API response: status=${res.status}, entries=${Array.isArray(res.data?.data) ? res.data.data.length : Array.isArray(res.data?.entries) ? res.data.entries.length : Array.isArray(res.data) ? res.data.length : 'unknown'}`,
      );

      return res.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to get conversations for page ${pageId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Sync a single conversation (used by internal API).
   * Calls getConversations with a filter for the specific conversation ID
   * and returns the normalized result if found.
   */
  async getConversationById(
    pageId: string,
    conversationId: string,
  ): Promise<PancakeConversation | null> {
    // Try to fetch recent conversations and find the matching one
    const limit =
      Number(process.env.PANCAKE_CONVERSATION_SYNC_PAGE_LIMIT || 50) || 50;

    try {
      const response = await this.getConversations(pageId, { limit });

      const rawEntries: any[] =
        response?.data ||
        response?.entries ||
        (Array.isArray(response) ? response : []);

      const entries: PancakeConversation[] = Array.isArray(rawEntries)
        ? rawEntries
        : [];

      const found = entries.find(
        (c: any) =>
          String(c.conversation_id || c.id || '') === conversationId,
      );

      return found || null;
    } catch {
      return null;
    }
  }
}