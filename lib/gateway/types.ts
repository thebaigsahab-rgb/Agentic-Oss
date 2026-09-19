/**
 * Industrial-Grade WhatsApp Command Gateway Types & Interfaces
 * Designed for Zero-Trust Asynchronous Architecture
 */

export type ProviderName = "meta" | "twilio";

export interface InboundCommandMessage {
  provider: ProviderName;
  messageId: string;
  senderNumber: string; // E.164 formatted (e.g., +923001234567)
  senderName?: string;
  text: string;
  timestamp: number;
  rawPayload: Record<string, unknown>;
}

export interface OutboundPayload {
  to: string; // E.164 formatted
  text: string;
  interactive?: {
    type: "button";
    bodyText: string;
    buttons: Array<{ id: string; title: string }>;
  };
  template?: {
    name: string;
    language: string;
    components?: unknown[];
  };
}

export interface ProviderSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: ProviderName;
  timestamp: number;
}

export interface WhatsAppAdapter {
  readonly name: ProviderName;

  /**
   * Cryptographically verifies inbound webhook signature against byte-exact raw body.
   */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>;

  /**
   * Parses raw webhook payload into normalized InboundCommandMessage.
   */
  parseInboundMessage(payload: Record<string, unknown>): InboundCommandMessage | null;

  /**
   * Dispatches outbound message to E.164 recipient via official Cloud/REST API.
   */
  sendMessage(payload: OutboundPayload): Promise<ProviderSendResult>;
}

export type GatewayJobStatus =
  | "queued"
  | "awaiting_approval"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface GatewayJob {
  id: string;
  provider: ProviderName;
  providerMessageId: string;
  senderNumber: string; // E.164
  rawText: string;
  intent: string;
  isSensitive: boolean;
  status: GatewayJobStatus;
  parameters: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  approvalId?: string;
  result?: string;
  error?: string;
}

export interface ApprovalRecord {
  approvalId: string;
  jobId: string;
  codeHash: string;
  salt: string;
  actionSummary: string;
  senderNumber: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
}

export interface IdempotencyEntry {
  key: string;
  firstSeenAt: number;
  senderNumber: string;
  status: "PROCESSED" | "PROCESSING";
}
