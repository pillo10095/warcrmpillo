// ============================================================
// OpenWA provider — sends messages through a local OpenWA gateway
// (REST API on port 2785, WhatsApp Web / Baileys under the hood).
//
// This is the "gratis" backend: no per-message fee, no Meta
// templates. Use it for the opt-in secondary line and bulk
// campaigns. The gateway stores its own data in SQLite; this
// provider only talks HTTP.
//
// Wire shapes follow the OpenWA REST spec (docs/06-api-specification):
//   - Media sends use a FLAT DTO { chatId, url, caption, filename } —
//     there is no nested { image: {...} } wrapper.
//   - Bulk takes { messages: [{ chatId, type, content }], options }.
//   - Batch status nests counts under progress { total, sent, ... }.
//   - Single-send responses are { messageId, timestamp } (epoch secs).
// ============================================================

import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import type {
  BulkMessage,
  BulkResult,
  BatchStatus,
  MediaMessage,
  ProviderStatus,
  SendResult,
  WhatsAppProvider,
  WhatsAppProviderType,
} from './types';

function chatIdFromPhone(phone: string): string {
  return `${sanitizePhoneForMeta(phone)}@c.us`;
}

export interface OpenWAProviderOptions {
  apiUrl: string;
  apiKey: string;
  sessionId: string;
}

export interface OpenWASessionSummary {
  id: string;
  name: string;
  status: string;
  phone?: string | null;
  pushName?: string | null;
  engineLoaded?: boolean;
}

export class OpenWAProvider implements WhatsAppProvider {
  readonly type: WhatsAppProviderType = 'openwa';

  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly sessionId: string;

  constructor(options: OpenWAProviderOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.sessionId = options.sessionId;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenWA error (${res.status}): ${text || res.statusText}`);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    const data = await this.request<{ messageId: string; timestamp: number }>(
      `/sessions/${this.sessionId}/messages/send-text`,
      {
        method: 'POST',
        body: JSON.stringify({ chatId: chatIdFromPhone(to), text }),
      },
    );
    return {
      messageId: data.messageId,
      providerMessageId: data.messageId,
      timestamp: data.timestamp,
    };
  }

  async sendMedia(to: string, media: MediaMessage): Promise<SendResult> {
    const path = `/sessions/${this.sessionId}/messages/send-${
      media.type === 'audio' ? 'audio' : media.type
    }`;
    const body: Record<string, unknown> = { chatId: chatIdFromPhone(to) };
    if (media.url) body['url'] = media.url;
    if (media.caption) body['caption'] = media.caption;
    if (media.filename) body['filename'] = media.filename;

    const data = await this.request<{ messageId: string; timestamp: number }>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return {
      messageId: data.messageId,
      providerMessageId: data.messageId,
      timestamp: data.timestamp,
    };
  }

  async sendBulk(messages: BulkMessage[]): Promise<BulkResult> {
    const data = await this.request<{
      batchId: string;
      status: string;
      totalMessages: number;
    }>(`/sessions/${this.sessionId}/messages/send-bulk`, {
      method: 'POST',
      body: JSON.stringify({
        messages: messages.map((m) => ({
          chatId: chatIdFromPhone(m.to),
          type: 'text',
          content: { text: m.text },
        })),
        options: {
          delayBetweenMessages: 3000,
          randomizeDelay: false,
          stopOnError: false,
        },
      }),
    });
    return {
      batchId: data.batchId,
      totalMessages: data.totalMessages ?? messages.length,
    };
  }

  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    const data = await this.request<{
      batchId: string;
      status: string;
      progress?: { total?: number; sent?: number; failed?: number; pending?: number; cancelled?: number };
    }>(`/sessions/${this.sessionId}/messages/batch/${encodeURIComponent(batchId)}`);
    const progress = data.progress ?? {};
    return {
      batchId: data.batchId ?? batchId,
      sent: progress.sent ?? 0,
      failed: progress.failed ?? 0,
      pending: progress.pending ?? 0,
      status: data.status ?? 'pending',
    };
  }

  async getStatus(): Promise<ProviderStatus> {
    try {
      const data = await this.request<{ status: string; phone?: string | null }>(
        `/sessions/${this.sessionId}`,
      );
      return {
        connected: data.status === 'ready',
        status: data.status,
        phone: data.phone ?? null,
      };
    } catch (err) {
      return {
        connected: false,
        status: err instanceof Error ? `error: ${err.message}` : 'error',
        phone: null,
      };
    }
  }

  // ============================================================
  // Session management — used by the /api/openwa/session routes.
  // Session ids passed explicitly so a config can hold many lines.
  // ============================================================

  async createSession(name: string): Promise<OpenWASessionSummary> {
    const data = await this.request<OpenWASessionSummary>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return data;
  }

  async startSession(sessionId: string): Promise<OpenWASessionSummary> {
    const data = await this.request<OpenWASessionSummary>(
      `/sessions/${encodeURIComponent(sessionId)}/start`,
      { method: 'POST' },
    );
    return data;
  }

  async stopSession(sessionId: string): Promise<OpenWASessionSummary> {
    const data = await this.request<OpenWASessionSummary>(
      `/sessions/${encodeURIComponent(sessionId)}/stop`,
      { method: 'POST' },
    );
    return data;
  }

  async getQr(sessionId: string): Promise<{ qrCode: string; status: string }> {
    return this.request<{ qrCode: string; status: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/qr`,
    );
  }

  async getSession(sessionId: string): Promise<OpenWASessionSummary> {
    return this.request<OpenWASessionSummary>(
      `/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async registerWebhook(params: {
    sessionId: string;
    url: string;
    events: string[];
    secret?: string;
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      url: params.url,
      events: params.events,
      active: true,
    };
    if (params.secret) body['secret'] = params.secret;
    return this.request<{ id: string }>(
      `/sessions/${encodeURIComponent(params.sessionId)}/webhooks`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }
}
