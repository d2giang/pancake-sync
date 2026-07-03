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
   * Create an Axios instance with the appropriate auth for a given page.
   * Uses PANCAKE_PAGE_TOKENS or PANCAKE_PAGE_ID/PANCAKE_PAGE_ACCESS_TOKEN env config.
   *
   * Per Pancake's API docs, every page-level endpoint under
   * /public_api/v1|v2/pages/{page_id}/... is authenticated with the Page
   * Access Token passed as the `page_access_token` query parameter — there
   * is no Authorization header for either token type, and `access_token` is
   * the *User* Access Token used only for account-level endpoints
   * (GET /pages, generate_page_access_token), which this client doesn't call.
   */
  private clientForPage(pageId: string): AxiosInstance {
    const token = getPageToken(pageId);

    if (!token) {
      this.logger.warn(`No token configured for page ${pageId}`);
    }

    return axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      params: token ? { page_access_token: token } : {},
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
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
      // 'reply_inbox' = replying inside a Messenger conversation. The other
      // allowed values (reply_comment, private_replies) are for comment
      // moderation flows, not used by this internal send-message API.
      const body: Record<string, any> = { action: 'reply_inbox' };

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
      this.logger.error(`Failed to assign ${conversationId}: ${error.message}`);
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
      this.logger.error(
        `Failed to mark read ${conversationId}: ${error.message}`,
      );
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
   * Fetch message history for a conversation (used to backfill message
   * content, since Pancake's conversation-list/sync endpoints only return
   * conversation-level summaries, not individual messages).
   *
   * NOTE: this mirrors the path used by sendMessage() (GET vs POST on the
   * same resource), which is the documented convention for this API family.
   * Verify against Pancake's public API docs before relying on this in
   * production — the response shape assumption (`data`/`entries` array,
   * same as getConversations) has not been confirmed against a live call.
   */
  async getConversationMessages(
    pageId: string,
    conversationId: string,
    params?: { limit?: number; before?: string; after?: string },
  ): Promise<PancakeApiResponse> {
    const client = this.clientForPage(pageId);

    try {
      const query: Record<string, any> = {};
      if (params?.limit) query.limit = params.limit;
      if (params?.before) query.before = params.before;
      if (params?.after) query.after = params.after;

      const res = await client.get(
        `/v1/pages/${pageId}/conversations/${conversationId}/messages`,
        { params: query },
      );

      return res.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to get messages for ${conversationId} on page ${pageId}: ${error.message}`,
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
      last_c?: string; // Pancake pagination cursor (replaces after/before)
      updated_since?: string;
      updated_until?: string;
    },
  ): Promise<PancakeApiResponse<PancakeConversation[]>> {
    const client = this.clientForPage(pageId);

    try {
      const query: Record<string, any> = {};

      if (params?.limit) query.limit = params.limit;
      if (params?.last_c) query.last_c = params.last_c;
      if (params?.updated_since) query.updated_since = params.updated_since;
      if (params?.updated_until) query.updated_until = params.updated_until;

      const res = await client.get(`/v2/pages/${pageId}/conversations`, {
        params: query,
      });

      // Diagnostic: log first sync to verify API connectivity
      this.logger.log(
        `Pancake conversations API response: status=${res.status}, entries=${Array.isArray(res.data?.conversations) ? res.data.conversations.length : 'unknown'}`,
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
        response?.conversations ||
        response?.data ||
        response?.entries ||
        (Array.isArray(response) ? response : []);

      const entries: PancakeConversation[] = Array.isArray(rawEntries)
        ? rawEntries
        : [];

      const found = entries.find(
        (c: any) => String(c.conversation_id || c.id || '') === conversationId,
      );

      return found || null;
    } catch {
      return null;
    }
  }
}
