import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'IMPORTANT' | 'ERROR' | 'DEBUG';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  private readonly baseDataPath = path.join(process.cwd(), 'data', 'webhook');
  private readonly logMaxSize = 2 * 1024 * 1024;
  private readonly logKeepLastLines = 300;

  private logFilePath() {
    return path.join(this.baseDataPath, 'messenger_webhook.log');
  }

  private pendingRefsPath() {
    return path.join(this.baseDataPath, 'pending_refs.json');
  }

  private leadIndexPath() {
    return path.join(this.baseDataPath, 'lead_index.json');
  }

  private pancakeRecordsPath() {
    return path.join(this.baseDataPath, 'pancake-records.json');
  }

  private viewPath(fileName: string) {
    return path.join(__dirname, 'views', fileName);
  }

  private readViewFile(fileName: string): string {
    return fs.readFileSync(this.viewPath(fileName), 'utf8');
  }

  private renderTemplate(template: string, data: Record<string, string>) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      return data[key] ?? '';
    });
  }

  private truncateLogIfNeeded() {
    const filePath = this.logFilePath();

    if (!fs.existsSync(filePath)) return;

    const stat = fs.statSync(filePath);
    if (stat.size < this.logMaxSize) return;

    try {
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      const tail = lines.slice(-this.logKeepLastLines).join('\n');
      fs.writeFileSync(filePath, tail.endsWith('\n') ? tail : `${tail}\n`);
    } catch {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  }

  logLine(message: string, context: any = {}, level: LogLevel = 'IMPORTANT') {
    const debugLog = process.env.WEBHOOK_DEBUG_LOG === 'true';

    if (level === 'DEBUG' && !debugLog) return;

    if (
      !['IMPORTANT', 'ERROR'].includes(level) &&
      !(level === 'DEBUG' && debugLog)
    ) {
      return;
    }

    const dir = path.dirname(this.logFilePath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.truncateLogIfNeeded();

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const safeContext =
      context && Object.keys(context).length > 0
        ? ` ${JSON.stringify(context)}`
        : '';

    fs.appendFileSync(
      this.logFilePath(),
      `[${timestamp}][${level}] ${message}${safeContext}\n`,
      'utf8',
    );

    if (level === 'ERROR') {
      this.logger.error(message, JSON.stringify(context));
      return;
    }

    this.logger.log(`[${level}] ${message} ${JSON.stringify(context)}`);
  }

  verifySignature(rawBody: string, header: string): boolean {
    const secret = process.env.META_APP_SECRET || '';

    if (!secret) return true;

    if (!header || !header.startsWith('sha256=')) {
      this.logLine(
        'Missing or invalid X-Hub-Signature-256 header',
        {},
        'ERROR',
      );
      return false;
    }

    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    if (Buffer.byteLength(expected) !== Buffer.byteLength(header)) {
      this.logLine('Signature validation failed', {}, 'ERROR');
      return false;
    }

    const valid = crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(header),
    );

    if (!valid) {
      this.logLine('Signature validation failed', {}, 'ERROR');
    }

    return valid;
  }

  private readJsonFile(filePath: string): any {
    if (!fs.existsSync(filePath)) return {};

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) return {};
      return JSON.parse(raw);
    } catch {
      this.logLine('Invalid JSON file content', { path: filePath }, 'ERROR');
      return {};
    }
  }

  private writeJsonFile(filePath: string, data: any) {
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  loadPendingRefs(): Record<string, any> {
    return this.readJsonFile(this.pendingRefsPath()) || {};
  }

  savePendingRefs(data: Record<string, any>) {
    this.writeJsonFile(this.pendingRefsPath(), data);
  }

  loadLeadIndex(): Record<string, any> {
    return this.readJsonFile(this.leadIndexPath()) || {};
  }

  saveLeadIndex(data: Record<string, any>) {
    this.writeJsonFile(this.leadIndexPath(), data);
  }

  cleanOldPendingRefs(maxAgeSeconds = 86400) {
    const all = this.loadPendingRefs();
    const threshold = Date.now() - maxAgeSeconds * 1000;
    let changed = false;

    for (const conversationId of Object.keys(all)) {
      const row = all[conversationId];

      if (!row || !row.captured_at) {
        delete all[conversationId];
        changed = true;
        continue;
      }

      const time = new Date(row.captured_at).getTime();

      if (!time || time < threshold) {
        delete all[conversationId];
        changed = true;
      }
    }

    if (changed) this.savePendingRefs(all);
  }

  setPendingRef(conversationId: string, payload: any) {
    const all = this.loadPendingRefs();

    all[conversationId] = {
      ...payload,
      captured_at: payload.captured_at || new Date().toISOString(),
    };

    this.savePendingRefs(all);
  }

  getPendingRef(conversationId: string): any | null {
    return this.loadPendingRefs()[conversationId] || null;
  }

  removePendingRef(conversationId: string) {
    const all = this.loadPendingRefs();

    if (all[conversationId]) {
      delete all[conversationId];
      this.savePendingRefs(all);
    }
  }

  setLeadIndex(conversationId: string, recordId: string) {
    const all = this.loadLeadIndex();

    all[conversationId] = {
      record_id: recordId,
      updated_at: new Date().toISOString(),
    };

    this.saveLeadIndex(all);
  }

  getLeadRecordId(conversationId: string): string | null {
    const row = this.loadLeadIndex()[conversationId];

    return row?.record_id || null;
  }

  buildConversationId(pageId: string, senderId: string): string {
    return `${pageId}_${senderId}`;
  }

  detectEventType(event: any): string {
    if (event.message) return 'message';
    if (event.postback) return 'postback';
    if (event.referral) return 'referral';
    if (event.read) return 'read';
    if (event.delivery) return 'delivery';

    return 'unknown';
  }

  extractRef(event: any): string | null {
    return (
      event?.postback?.referral?.ref ||
      event?.referral?.ref ||
      event?.message?.referral?.ref ||
      null
    );
  }

  isEchoMessage(event: any): boolean {
    return !!event?.message?.is_echo;
  }

  isUserMessage(event: any): boolean {
    return !!event?.message?.text && !event?.message?.is_echo;
  }

  async processMessagingEvent(event: any) {
    const senderId = String(event?.sender?.id || '');
    const recipientId = String(event?.recipient?.id || '');
    const eventType = this.detectEventType(event);
    const ref = this.extractRef(event);

    if (eventType === 'delivery' || eventType === 'read') return;
    if (this.isEchoMessage(event)) return;

    const pageId = recipientId;
    const userId = senderId;
    const conversationId = this.buildConversationId(pageId, userId);

    if (ref && pageId && userId) {
      await this.handleRefCapture(pageId, userId, ref);
    }

    if (this.isUserMessage(event) && pageId && userId) {
      await this.retryPendingRefSync(conversationId);
    }
  }

  async handleRefCapture(pageId: string, senderId: string, ref: string) {
    const conversationId = this.buildConversationId(pageId, senderId);

    this.setPendingRef(conversationId, {
      ref,
      page_id: pageId,
      sender_id: senderId,
      captured_at: new Date().toISOString(),
    });

    const ok = await this.syncRefToPancake(conversationId, ref);

    if (ok) {
      this.removePendingRef(conversationId);
    }
  }

  async retryPendingRefSync(conversationId: string) {
    const pending = this.getPendingRef(conversationId);

    if (!pending?.ref) return;

    const ok = await this.syncRefToPancake(conversationId, String(pending.ref));

    if (ok) {
      this.removePendingRef(conversationId);
    }
  }

  private pancakeUrl(apiPath: string, query: Record<string, any> = {}) {
    const baseUrl =
      process.env.PANCAKE_BASE_URL || 'https://crm.pancake.vn/api';

    query.api_key = process.env.PANCAKE_API_KEY;

    return `${baseUrl.replace(/\/$/, '')}${apiPath}?${new URLSearchParams(
      query,
    ).toString()}`;
  }

  async pancakeUpdateLeadRef(recordId: string, ref: string): Promise<boolean> {
    const workspace = process.env.PANCAKE_WORKSPACE || '607';
    const table = process.env.PANCAKE_TABLE || 'lead';

    const url = this.pancakeUrl(`/workspaces/${workspace}/${table}/records`);

    try {
      const result = await axios.post(
        url,
        {
          id: recordId,
          ref,
        },
        {
          timeout: 30000,
          headers: {
            Accept: 'application/json',
          },
        },
      );

      if (result.data?.success === false) {
        this.logLine(
          'Pancake update lead ref failed',
          {
            record_id: recordId,
            raw: result.data,
          },
          'ERROR',
        );

        return false;
      }

      return true;
    } catch (error: any) {
      this.logLine(
        'Pancake update lead ref failed',
        {
          record_id: recordId,
          message: error.message,
          response: error.response?.data,
        },
        'ERROR',
      );

      return false;
    }
  }

  async pancakeFindRecordIdByConversationId(
    conversationId: string,
  ): Promise<string | null> {
    const cached = this.getLeadRecordId(conversationId);
    if (cached) return cached;

    const workspace = process.env.PANCAKE_WORKSPACE || '607';
    const table = process.env.PANCAKE_TABLE || 'lead';

    const filter = {
      fields: [
        {
          field_name: 'conversation_id',
          type: '$having_value',
          value: conversationId,
          is_filter_exclude: false,
        },
      ],
    };

    try {
      const url = this.pancakeUrl(`/workspaces/${workspace}/${table}/records`, {
        view_id: 'all',
        filter: JSON.stringify(filter),
      });

      const result = await axios.get(url, {
        timeout: 30000,
        headers: {
          Accept: 'application/json',
        },
      });

      const entries = result.data?.entries || result.data?.data?.entries || [];

      for (const entry of entries) {
        if (entry?.conversation_id === conversationId && entry?.id) {
          const recordId = String(entry.id);
          this.setLeadIndex(conversationId, recordId);
          return recordId;
        }
      }
    } catch {}

    this.logLine(
      'Lead not found in Pancake',
      {
        conversation_id: conversationId,
      },
      'ERROR',
    );

    return null;
  }

  async syncRefToPancake(
    conversationId: string,
    ref: string,
  ): Promise<boolean> {
    let recordId = this.getLeadRecordId(conversationId);

    if (!recordId) {
      recordId = await this.pancakeFindRecordIdByConversationId(conversationId);
    }

    if (!recordId) {
      this.logLine(
        'Cannot sync ref because record id not found',
        {
          conversation_id: conversationId,
          ref,
        },
        'ERROR',
      );

      return false;
    }

    const ok = await this.pancakeUpdateLeadRef(recordId, ref);

    if (ok) {
      this.updateLocalPancakeRecordRef(conversationId, ref);

      this.logLine('Ref synced', {
        conversation_id: conversationId,
        record_id: recordId,
        ref,
      });
    }

    return ok;
  }

  isPancakePayload(data: any): boolean {
    return !!(
      data?.table_id &&
      data?.workspace_id &&
      data?.conversation_id &&
      data?.id
    );
  }

  isPancakeCreatedRecord(payload: any): boolean {
    if (payload?.event === 'record' && payload?.action === 'created') {
      return true;
    }

    if (payload?.type === 'records' && payload?.event_type === 'insert') {
      return true;
    }

    return false;
  }

  extractPancakeRecordData(payload: any): any {
    if (payload?.event === 'record' && payload?.action === 'created') {
      return payload?.data && typeof payload.data === 'object'
        ? payload.data
        : {};
    }

    if (payload?.type === 'records' && payload?.event_type === 'insert') {
      return payload;
    }

    return {};
  }

  async handlePancakeWebhook(data: any) {
    if (this.isPancakeCreatedRecord(data)) {
      const record = this.extractPancakeRecordData(data);
      const receivedAt = new Date().toISOString();

      if (Object.keys(record).length > 0) {
        this.logPancakeNewRecord(record);
        this.savePancakeRecord(record);
        await this.forwardToLaravel(record, receivedAt);
      }
    }

    if (this.isPancakePayload(data)) {
      await this.handlePancakePayload(data);
    }
  }

  async handlePancakePayload(data: any) {
    const workspaceId = Number(data.workspace_id || 0);
    const tableId = String(data.table_id || '');
    const conversationId = String(data.conversation_id || '');
    const recordId = String(data.id || '');

    if (workspaceId !== Number(process.env.PANCAKE_WORKSPACE || 607)) return;
    if (tableId !== String(process.env.PANCAKE_TABLE || 'lead')) return;
    if (!conversationId || !recordId) return;

    this.setLeadIndex(conversationId, recordId);
    await this.retryPendingRefSync(conversationId);
  }

  savePancakeRecord(record: any) {
    const filePath = this.pancakeRecordsPath();
    const records = Array.isArray(this.readJsonFile(filePath))
      ? this.readJsonFile(filePath)
      : [];

    const conversationId = String(record.conversation_id || '');

    if (conversationId) {
      const pending = this.getPendingRef(conversationId);

      if (pending?.ref) {
        record.ref = String(pending.ref);
      }
    }

    records.push({
      received_at: new Date().toISOString(),
      data: record,
    });

    this.writeJsonFile(filePath, records);
  }

  getPancakeRecords(page = 1, perPage = 50) {
    const filePath = this.pancakeRecordsPath();
    const records = Array.isArray(this.readJsonFile(filePath))
      ? this.readJsonFile(filePath)
      : [];

    const reversed = [...records].reverse();
    const safePage = Math.max(1, page);
    const total = reversed.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const offset = (safePage - 1) * perPage;

    return {
      success: true,
      page: safePage,
      per_page: perPage,
      total,
      total_pages: totalPages,
      data: reversed.slice(offset, offset + perPage),
    };
  }

  logPancakeNewRecord(record: any) {
    this.logLine('NEW PANCAKE RECORD CREATED', {
      workspace_id: record.workspace_id || null,
      table_id: record.table_id || null,
      record_id: record.id || null,
      name: record.name || null,
      phone: record.phone_number || null,
      email: record.email || null,
      status: record.status || null,
      created_on: record.created_on || null,
      modified_on: record.modified_on || null,
      full_data: record,
    });
  }

  updateLocalPancakeRecordRef(conversationId: string, ref: string) {
    const filePath = this.pancakeRecordsPath();
    const records = Array.isArray(this.readJsonFile(filePath))
      ? this.readJsonFile(filePath)
      : [];

    let changed = false;

    for (const item of records) {
      if (item?.data?.conversation_id === conversationId) {
        item.data.ref = ref;
        changed = true;
      }
    }

    if (changed) {
      this.writeJsonFile(filePath, records);
    }
  }

  private mapPancakeRecordForLaravel(record: any, receivedAt?: string) {
    const customer = record.pancake_customer_obj ?? null;

    return {
      event: 'pancake.lead.created',
      source: 'pancake',
      received_at: receivedAt ?? new Date().toISOString(),

      lead: {
        pancake_id: record.id ?? null,
        workspace_id: record.workspace_id ?? null,
        table_id: record.table_id ?? null,

        name: record.name ?? null,
        phone_number: record.phone_number ?? null,
        email: record.email ?? null,
        status: record.status ?? null,
        gender: record.gender ?? null,

        conversation_id: record.conversation_id ?? null,
        page_id: record.page_id ?? customer?.page_id ?? null,
        facebook_id: record.facebookid ?? customer?.fb_id ?? null,
        ref: record.ref ?? null,
        conversation_source: record.conversation_source ?? null,

        created_on: record.created_on ?? null,
        modified_on: record.modified_on ?? null,
      },

      customer: customer
        ? {
            id: record.pancake_customer ?? customer.id ?? null,
            customer_id: customer.customer_id ?? null,
            name: customer.name ?? null,
            page_id: customer.page_id ?? null,
            fb_id: customer.fb_id ?? null,
            psid: customer.psid ?? null,
            phone_numbers: customer.phone_numbers ?? [],
          }
        : null,

      utm: {
        utm_source: record.utm_source ?? null,
        utm_medium: record.utm_medium ?? null,
        utm_campaign: record.utm_campaign ?? null,
        utm_term: record.utm_term ?? null,
        utm_content: record.utm_content ?? null,
        utm_id: record.utm_id ?? null,
      },

      raw_data: record,
    };
  }

  async forwardToLaravel(record: any, receivedAt?: string) {
    const url = process.env.LARAVEL_WEBHOOK_URL;

    if (!url) {
      this.logLine('Laravel webhook URL is empty, skip forward', {}, 'DEBUG');
      return;
    }

    const payload = this.mapPancakeRecordForLaravel(record, receivedAt);

    try {
      await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': process.env.LARAVEL_WEBHOOK_SECRET || '',
        },
        timeout: 10000,
      });

      this.logLine('Forwarded Pancake record to Laravel', {
        pancake_id: record.id ?? null,
        url,
      });
    } catch (error: any) {
      this.logLine(
        'Forward Pancake record to Laravel failed',
        {
          pancake_id: record.id ?? null,
          message: error.message,
          response: error.response?.data,
        },
        'ERROR',
      );
    }
  }

  getLogTail(lines = 80): string[] {
    const filePath = this.logFilePath();

    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      return content.filter(Boolean).slice(-lines);
    } catch {
      return [];
    }
  }

  private escapeHtml(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async renderRefSyncDashboard(query: any): Promise<string> {
    let message: string | null = null;

    if (query?.action === 'sync_one') {
      const conversationId = String(query.conversation_id || '');

      if (conversationId) {
        const pending = this.getPendingRef(conversationId);

        if (pending?.ref) {
          const ok = await this.syncRefToPancake(
            conversationId,
            String(pending.ref),
          );

          if (ok) {
            this.removePendingRef(conversationId);
            message = `Dong bo thanh cong: ${conversationId}`;
          } else {
            message = `Dong bo that bai: ${conversationId}`;
          }
        } else {
          message = `Khong tim thay pending ref cho: ${conversationId}`;
        }
      }
    }

    if (query?.action === 'sync_all') {
      const pendingRefs = this.loadPendingRefs();
      let success = 0;
      let failed = 0;

      for (const [conversationId, row] of Object.entries(pendingRefs)) {
        if (!row || typeof row !== 'object' || !(row as any).ref) continue;

        const ok = await this.syncRefToPancake(
          conversationId,
          String((row as any).ref),
        );

        if (ok) {
          this.removePendingRef(conversationId);
          success++;
        } else {
          failed++;
        }
      }

      message = `Dong bo tat ca xong. Thanh cong: ${success}, loi: ${failed}`;
    }

    const pendingRefs = this.loadPendingRefs();
    const leadIndex = this.loadLeadIndex();
    const logs = this.getLogTail(100);

    const rows =
      Object.entries(pendingRefs)
        .filter(([, row]) => row && typeof row === 'object')
        .map(([conversationId, row]: [string, any]) => {
          const ref = String(row.ref || '');
          const recordId = leadIndex?.[conversationId]?.record_id || null;
          const syncUrl = `?ref_sync=1&action=sync_one&conversation_id=${encodeURIComponent(
            conversationId,
          )}`;

          return `<tr>
            <td>${this.escapeHtml(conversationId)}</td>
            <td>${this.escapeHtml(ref)}</td>
            <td>${this.escapeHtml(row.page_id || '')}</td>
            <td>${this.escapeHtml(row.sender_id || '')}</td>
            <td>${this.escapeHtml(row.captured_at || '')}</td>
            <td>${this.escapeHtml(recordId || 'Chua co')}</td>
            ${recordId ? '<td class="ok">Co record_id</td>' : '<td class="bad">Chua tim thay record_id</td>'}
            <td><a class="btn" href="${syncUrl}">Dong bo lai</a></td>
          </tr>`;
        })
        .join('') ||
      '<tr><td colspan="8" class="ok">Khong con pending ref nao</td></tr>';

    return this.renderTemplate(this.readViewFile('ref-sync-dashboard.html'), {
      css: this.readViewFile('ref-sync-dashboard.css'),
      message: message
        ? `<div class="box"><b>${this.escapeHtml(message)}</b></div>`
        : '',
      rows,
      leadIndexCount: String(Object.keys(leadIndex).length),
      logs: logs.map((line) => this.escapeHtml(line)).join('\n'),
    });
  }
}
