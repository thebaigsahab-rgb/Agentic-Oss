import type {
  InboundCommandMessage,
  OutboundPayload,
  ProviderSendResult,
  WhatsAppAdapter,
} from "../types";
import {
  computeHmacSha256Hex,
  normalizeE164,
  timingSafeStringCompare,
} from "../crypto";

export interface MetaAdapterConfig {
  appSecret?: string;
  accessToken?: string;
  phoneNumberId?: string;
  apiVersion?: string;
}

/**
 * Meta WhatsApp Cloud API (Graph API v20.0+) Provider Adapter
 * Strictly verifies raw-body HMAC-SHA256 signatures before JSON processing.
 */
export class MetaWhatsAppAdapter implements WhatsAppAdapter {
  readonly name = "meta" as const;
  private readonly appSecret: string;
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;

  constructor(config?: MetaAdapterConfig) {
    this.appSecret = config?.appSecret ?? process.env.WHATSAPP_APP_SECRET ?? "";
    this.accessToken = config?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? "";
    this.phoneNumberId = config?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    this.apiVersion = config?.apiVersion ?? process.env.WHATSAPP_API_VERSION ?? "v20.0";
  }

  /**
   * Cryptographically verifies inbound webhook signature against byte-exact raw body.
   * Header: 'x-hub-signature-256: sha256=<hex>'
   */
  async verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
    if (!this.appSecret) {
      return false;
    }

    const signatureHeader =
      req.headers.get("x-hub-signature-256") ||
      req.headers.get("X-Hub-Signature-256");

    if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
      return false;
    }

    const providedSignature = signatureHeader.slice(7).trim();
    if (!providedSignature) {
      return false;
    }

    const expectedSignature = computeHmacSha256Hex(this.appSecret, rawBody);
    return timingSafeStringCompare(expectedSignature, providedSignature);
  }

  /**
   * Parses raw webhook payload into normalized InboundCommandMessage.
   * Handles text messages, interactive button replies, and quick-reply buttons.
   */
  parseInboundMessage(payload: Record<string, unknown>): InboundCommandMessage | null {
    try {
      const entry = (payload?.entry as Array<Record<string, unknown>>) ?? [];
      if (!Array.isArray(entry) || entry.length === 0) return null;

      const firstEntry = entry[0];
      const changes = (firstEntry?.changes as Array<Record<string, unknown>>) ?? [];
      if (!Array.isArray(changes) || changes.length === 0) return null;

      const changeValue = changes[0]?.value as Record<string, unknown> | undefined;
      if (!changeValue) return null;

      const messages = changeValue.messages as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(messages) || messages.length === 0) {
        // Status webhook or non-message event (sent, delivered, read)
        return null;
      }

      const msg = messages[0];
      const messageId = String(msg.id || "").trim();
      const rawFrom = String(msg.from || "").trim();

      if (!messageId || !rawFrom) return null;

      const senderNumber = normalizeE164(rawFrom);
      if (!senderNumber) return null;

      // Extract sender contact profile name if available
      const contacts = changeValue.contacts as Array<Record<string, unknown>> | undefined;
      let senderName: string | undefined;
      if (Array.isArray(contacts) && contacts.length > 0) {
        const profile = contacts[0].profile as Record<string, unknown> | undefined;
        if (profile?.name && typeof profile.name === "string") {
          senderName = profile.name.trim();
        }
      }

      // Extract message text according to type
      let text = "";
      const msgType = String(msg.type || "");

      if (msgType === "text" && msg.text && typeof msg.text === "object") {
        const textObj = msg.text as Record<string, unknown>;
        text = String(textObj.body || "").trim();
      } else if (msgType === "interactive" && msg.interactive && typeof msg.interactive === "object") {
        const interactiveObj = msg.interactive as Record<string, unknown>;
        if (interactiveObj.button_reply && typeof interactiveObj.button_reply === "object") {
          const btn = interactiveObj.button_reply as Record<string, unknown>;
          text = String(btn.id || btn.title || "").trim();
        }
      } else if (msgType === "button" && msg.button && typeof msg.button === "object") {
        const btnObj = msg.button as Record<string, unknown>;
        text = String(btnObj.text || btnObj.payload || "").trim();
      }

      if (!text) return null;

      const rawTimestamp = Number(msg.timestamp);
      const timestamp = !isNaN(rawTimestamp) && rawTimestamp > 0
        ? rawTimestamp * 1000
        : Date.now();

      return {
        provider: this.name,
        messageId,
        senderNumber,
        senderName,
        text,
        timestamp,
        rawPayload: payload,
      };
    } catch {
      return null;
    }
  }

  /**
   * Dispatches outbound message to E.164 recipient via Meta WhatsApp Graph API v20.0+.
   */
  async sendMessage(payload: OutboundPayload): Promise<ProviderSendResult> {
    const timestamp = Date.now();

    if (!this.accessToken || !this.phoneNumberId) {
      return {
        success: false,
        error: "Missing Meta WhatsApp API credentials (WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID)",
        provider: this.name,
        timestamp,
      };
    }

    const normalizedRecipient = normalizeE164(payload.to);
    if (!normalizedRecipient) {
      return {
        success: false,
        error: `Invalid E.164 recipient phone number: ${payload.to}`,
        provider: this.name,
        timestamp,
      };
    }

    // Meta API recipient expects country code digits without the leading '+'
    const recipientDigits = normalizedRecipient.replace(/^\+/, "");
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    let requestBody: Record<string, unknown>;

    if (payload.interactive && payload.interactive.buttons.length > 0) {
      requestBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientDigits,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: payload.interactive.bodyText,
          },
          action: {
            buttons: payload.interactive.buttons.slice(0, 3).map((btn) => ({
              type: "reply",
              reply: {
                id: btn.id,
                title: btn.title.slice(0, 20),
              },
            })),
          },
        },
      };
    } else {
      requestBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientDigits,
        type: "text",
        text: {
          preview_url: false,
          body: payload.text,
        },
      };
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const responseData = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const errorDetail =
          (responseData?.error as Record<string, unknown>)?.message ||
          JSON.stringify(responseData) ||
          `HTTP ${response.status} ${response.statusText}`;
        return {
          success: false,
          error: String(errorDetail),
          provider: this.name,
          timestamp,
        };
      }

      const messages = responseData?.messages as Array<Record<string, unknown>> | undefined;
      const sentMessageId = messages?.[0]?.id ? String(messages[0].id) : undefined;

      return {
        success: true,
        messageId: sentMessageId,
        provider: this.name,
        timestamp,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        provider: this.name,
        timestamp,
      };
    }
  }
}
