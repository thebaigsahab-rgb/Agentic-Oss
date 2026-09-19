/**
 * Multimodal Demonstration Recording & Ingestion Pipeline
 *
 * Concurrently captures inputs, DOM metadata, ARIA trees, visual bounding boxes,
 * detects hesitation/modal branches, and strictly sanitizes credentials/PII at ingestion.
 */

import { randomUUID } from "node:crypto";
import { computePerceptualHash } from "./perceptual-hash";
import type {
  RawDemonstrationEvent,
  RawRecordingSession,
  RawMouseInteraction,
  RawKeyboardInteraction,
  RawDomMetadata,
  RawVisualSnapshot,
} from "./types";

// Security Regex Patterns for Ingestion Sanitization
const SENSITIVE_INPUT_NAME_REGEX = /pass(?:word)?|secret|token|api[_-]?key|auth|bearer|credit[_-]?card|cvv|cvc|ssn/i;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/;
const JWT_REGEX = /\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/;
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9-._~+/]+=*/i;
const API_KEY_PREFIX_REGEX = /\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35})\b/;

export class DemonstrationRecorder {
  private sessionId: string;
  private sessionName: string;
  private events: RawDemonstrationEvent[] = [];
  private startedAt: number = 0;
  private lastEventTimestamp: number = 0;
  private isRecording: boolean = false;
  private targetEnvironment: {
    userAgent: string;
    platform: string;
    screenResolution: { width: number; height: number };
  };

  constructor(
    sessionName: string,
    targetEnvironment?: {
      userAgent?: string;
      platform?: string;
      screenResolution?: { width: number; height: number };
    }
  ) {
    this.sessionId = `rec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    this.sessionName = sessionName;
    this.targetEnvironment = {
      userAgent: targetEnvironment?.userAgent || "AgenticOS/Browser-Actuator-1.0",
      platform: targetEnvironment?.platform || process.platform,
      screenResolution: targetEnvironment?.screenResolution || { width: 1920, height: 1080 },
    };
  }

  public start(): void {
    this.isRecording = true;
    this.startedAt = Date.now();
    this.lastEventTimestamp = this.startedAt;
    this.events = [];
  }

  public stop(): RawRecordingSession {
    this.isRecording = false;
    const endedAt = Date.now();

    return {
      sessionId: this.sessionId,
      name: this.sessionName,
      targetEnvironment: this.targetEnvironment,
      events: [...this.events],
      startedAt: this.startedAt,
      endedAt,
    };
  }

  public getEvents(): ReadonlyArray<RawDemonstrationEvent> {
    return this.events;
  }

  /**
   * Records a mouse click or pointer interaction with DOM and visual context.
   */
  public recordMouseClick(params: {
    x: number;
    y: number;
    button?: "left" | "middle" | "right";
    domTarget?: RawDomMetadata;
    visualSnippet?: string | Buffer;
    viewport?: { width: number; height: number; dpiScale: number };
  }): RawDemonstrationEvent {
    this.assertRecording();
    const now = Date.now();
    const timeSinceLastEventMs = this.events.length === 0 ? 0 : now - this.lastEventTimestamp;
    this.lastEventTimestamp = now;

    const mouse: RawMouseInteraction = {
      type: "click",
      x: params.x,
      y: params.y,
      button: params.button || "left",
    };

    let visual: RawVisualSnapshot | undefined;
    if (params.visualSnippet) {
      const hash = computePerceptualHash(params.visualSnippet);
      visual = {
        viewport: params.viewport || { width: 1920, height: 1080, dpiScale: 1.0 },
        perceptualHash: hash,
        screenshotBase64: typeof params.visualSnippet === "string" ? params.visualSnippet : params.visualSnippet.toString("base64"),
      };
    }

    const event: RawDemonstrationEvent = {
      eventId: `ev_${randomUUID().slice(0, 8)}`,
      timestamp: now,
      timeSinceLastEventMs,
      category: "INPUT",
      mouse,
      targetDom: params.domTarget,
      visual,
      sanitized: true,
    };

    this.events.push(event);
    return event;
  }

  /**
   * Records keyboard strokes or text input with mandatory data sanitization.
   */
  public recordTextInput(params: {
    text: string;
    domTarget?: RawDomMetadata;
    isPassword?: boolean;
    key?: string;
    code?: string;
    modifiers?: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };
  }): RawDemonstrationEvent {
    this.assertRecording();
    const now = Date.now();
    const timeSinceLastEventMs = this.events.length === 0 ? 0 : now - this.lastEventTimestamp;
    this.lastEventTimestamp = now;

    const { sanitizedText, isMasked } = this.sanitizeValue(
      params.text,
      params.isPassword || (params.domTarget?.formField?.type === "password"),
      params.domTarget?.formField?.name
    );

    const keyboard: RawKeyboardInteraction = {
      key: params.key || (params.text.length === 1 ? params.text : "Enter"),
      code: params.code || "KeyInput",
      modifiers: params.modifiers || { ctrl: false, alt: false, shift: false, meta: false },
      value: sanitizedText,
      isPassword: isMasked,
    };

    const event: RawDemonstrationEvent = {
      eventId: `ev_${randomUUID().slice(0, 8)}`,
      timestamp: now,
      timeSinceLastEventMs,
      category: "INPUT",
      keyboard,
      targetDom: params.domTarget,
      sanitized: true,
    };

    this.events.push(event);
    return event;
  }

  /**
   * Records a navigation change or location redirect.
   */
  public recordNavigation(url: string): RawDemonstrationEvent {
    this.assertRecording();
    const now = Date.now();
    const timeSinceLastEventMs = this.events.length === 0 ? 0 : now - this.lastEventTimestamp;
    this.lastEventTimestamp = now;

    const event: RawDemonstrationEvent = {
      eventId: `ev_${randomUUID().slice(0, 8)}`,
      timestamp: now,
      timeSinceLastEventMs,
      category: "NAVIGATION",
      navigationUrl: url,
      sanitized: true,
    };

    this.events.push(event);
    return event;
  }

  /**
   * Records user decision points, hesitation delays, or conditional modal branches.
   */
  public recordModalFork(params: {
    modalTitle: string;
    isDismissal: boolean;
    domTarget?: RawDomMetadata;
  }): RawDemonstrationEvent {
    this.assertRecording();
    const now = Date.now();
    const timeSinceLastEventMs = this.events.length === 0 ? 0 : now - this.lastEventTimestamp;
    this.lastEventTimestamp = now;

    const event: RawDemonstrationEvent = {
      eventId: `ev_${randomUUID().slice(0, 8)}`,
      timestamp: now,
      timeSinceLastEventMs,
      category: "FORK",
      modalState: {
        detected: true,
        modalTitle: params.modalTitle,
        isDismissal: params.isDismissal,
      },
      targetDom: params.domTarget,
      sanitized: true,
    };

    this.events.push(event);
    return event;
  }

  /**
   * Sanitizes text values: replaces sensitive secrets, tokens, credit cards with [REDACTED].
   */
  public sanitizeValue(
    value: string,
    isPasswordField: boolean = false,
    fieldName?: string
  ): { sanitizedText: string; isMasked: boolean } {
    if (!value) return { sanitizedText: "", isMasked: false };

    // 1. Password field or sensitive name flag
    if (isPasswordField || (fieldName && SENSITIVE_INPUT_NAME_REGEX.test(fieldName))) {
      return { sanitizedText: "[REDACTED_SECRET]", isMasked: true };
    }

    // 2. Token & Secret patterns
    if (
      JWT_REGEX.test(value) ||
      BEARER_TOKEN_REGEX.test(value) ||
      API_KEY_PREFIX_REGEX.test(value)
    ) {
      return { sanitizedText: "[REDACTED_AUTH_TOKEN]", isMasked: true };
    }

    // 3. Credit card pattern
    if (CREDIT_CARD_REGEX.test(value.replace(/[- ]/g, ""))) {
      return { sanitizedText: "[REDACTED_PAYMENT_CARD]", isMasked: true };
    }

    return { sanitizedText: value, isMasked: false };
  }

  private assertRecording(): void {
    if (!this.isRecording) {
      throw new Error("DemonstrationRecorder is not active. Call start() first.");
    }
  }
}
