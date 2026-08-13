// ============================================================
// WhatsApp provider contract — shared types for the two send
// backends (Meta Cloud API + OpenWA gateway). The send core and
// the API routes depend on these interfaces, not on either
// provider's internals, so a provider can be swapped without
// touching callers.
// ============================================================

export type WhatsAppProviderType = "meta" | "openwa";

export interface MediaMessage {
  type: "image" | "video" | "document" | "audio";
  url: string;
  caption?: string;
  filename?: string;
}

export interface BulkMessage {
  to: string;
  text: string;
}

export interface SendResult {
  /** Our persisted `messages.id` (or provider id when not yet persisted). */
  messageId: string;
  /** Provider's own message id (Meta wamid / OpenWA messageId). */
  providerMessageId: string;
  timestamp: number;
}

export interface BulkResult {
  batchId: string;
  totalMessages: number;
}

export interface BatchStatus {
  batchId: string;
  sent: number;
  failed: number;
  pending: number;
  status: string;
}

export interface ProviderStatus {
  connected: boolean;
  status: string;
  phone?: string | null;
}

export interface WhatsAppProvider {
  readonly type: WhatsAppProviderType;
  sendText(to: string, text: string): Promise<SendResult>;
  sendMedia(to: string, media: MediaMessage): Promise<SendResult>;
  sendBulk(messages: BulkMessage[]): Promise<BulkResult>;
  getBatchStatus(batchId: string): Promise<BatchStatus>;
  getStatus(): Promise<ProviderStatus>;
}
