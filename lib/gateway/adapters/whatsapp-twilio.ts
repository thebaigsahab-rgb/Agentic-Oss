import type {
  InboundCommandMessage,
  OutboundPayload,
  ProviderSendResult,
  WhatsAppAdapter,
} from "../types";
import {
  computeHmacSha1Base64,
  normalizeE164,
  timingSafeStringCompare,
} from "../crypto";

export interface TwilioAdapterConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

/**
 * Twilio Messaging API Provider Adapter
 * Secondary / Failover adapter supporting Twilio's webhook signature (HMAC-SHA1) and REST dispatch.
 */
export class TwilioWhatsAppAdapter implements WhatsAppAdapter {
  readonly name = "twilio" as const;
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;

  constructor(config?: TwilioAdapterConfig) {
    this.accountSid = config?.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "";
    this.authToken = config?.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "";
    this.fromNumber = config?.fromNumber ?? process.env.TWILIO_PHONE_NUMBER ?? "";
  }

  /**
   * Cryptographically verifies Twilio webhook signature (X-Twilio-Signature).
   * Twilio signs: URL + sorted key-value pairs of POST body parameters with HMAC-SHA1.
   */
  async verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
    if (!this.authToken) {
      return false;
    }

    const signature =
      req.headers.get("x-twilio-signature") ||
      req.headers.get("X-Twilio-Signature");

    if (!signature) {
      return false;
    }

    // Determine target URL from request
    const url = req.url;

    // Parse parameters from rawBody (support both URL-encoded and JSON representations)
    const params: Record<string, string> = {};
    if (rawBody.trim().startsWith("{")) {
      try {
        const json = JSON.parse(rawBody) as Record<string, unknown>;
        for (const [key, val] of Object.entries(json)) {
          if (val !== null && val !== undefined) {
            params[key] = String(val);
          }
        }
      } catch {
        // Fall back to url search params
      }
    } else {
      const searchParams = new URLSearchParams(rawBody);
      searchParams.forEach((val, key) => {
        params[key] = val;
      });
    }

    // Twilio signature construction: URL concatenated with sorted keys and values
    const sortedKeys = Object.keys(params).sort();
    let dataToSign = url;
    for (const key of sortedKeys) {
      dataToSign += key + params[key];
    }

    const expectedSignature = computeHmacSha1Base64(this.authToken, dataToSign);
    return timingSafeStringCompare(expectedSignature, signature);
  }

  /**
   * Parses Twilio webhook payload into normalized InboundCommandMessage.
   */
  parseInboundMessage(payload: Record<string, unknown>): InboundCommandMessage | null {
    try {
      const messageSid = String(
        payload.MessageSid || payload.SmsMessageSid || payload.SmsSid || ""
      ).trim();
      const rawFrom = String(payload.From || "").trim();
      const text = String(payload.Body || "").trim();

      if (!messageSid || !rawFrom || !text) {
        return null;
      }

      const senderNumber = normalizeE164(rawFrom);
      if (!senderNumber) {
        return null;
      }

      const senderName = payload.ProfileName
        ? String(payload.ProfileName).trim()
        : undefined;

      return {
        provider: this.name,
        messageId: messageSid,
        senderNumber,
        senderName,
        text,
        timestamp: Date.now(),
        rawPayload: payload,
      };
    } catch {
      return null;
    }
  }

  /**
   * Dispatches outbound message via Twilio REST API.
   */
  async sendMessage(payload: OutboundPayload): Promise<ProviderSendResult> {
    const timestamp = Date.now();

    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      return {
        success: false,
        error: "Missing Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER)",
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

    const normalizedFrom = normalizeE164(this.fromNumber);
    if (!normalizedFrom) {
      return {
        success: false,
        error: `Invalid Twilio sender phone number: ${this.fromNumber}`,
        provider: this.name,
        timestamp,
      };
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const basicAuth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const formData = new URLSearchParams();
    formData.append("From", `whatsapp:${normalizedFrom}`);
    formData.append("To", `whatsapp:${normalizedRecipient}`);
    formData.append("Body", payload.text);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const responseData = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const errorMsg =
          responseData?.message ||
          JSON.stringify(responseData) ||
          `HTTP ${response.status} ${response.statusText}`;
        return {
          success: false,
          error: String(errorMsg),
          provider: this.name,
          timestamp,
        };
      }

      const sid = responseData?.sid ? String(responseData.sid) : undefined;

      return {
        success: true,
        messageId: sid,
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
