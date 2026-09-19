/**
 * Sovereign Personal Memory & Daily Life OS - Core Type Definitions
 * Enforces categorical isolation, deterministic provenance, cryptographic metadata envelopes,
 * and zero-trust actuation contracts.
 */

// 1. Strict Ten Permitted Memory Categories
export const MEMORY_CATEGORIES = [
  "people",
  "preferences",
  "routines",
  "projects",
  "commitments",
  "documents",
  "health_notes",
  "subscriptions",
  "purchases",
  "recurring_problems",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

// Restricted Categories: Mandatory Envelope Encryption (AES-256-GCM) & High-Privilege Boundary
export const RESTRICTED_CATEGORIES: readonly MemoryCategory[] = [
  "health_notes",
  "purchases",
  "subscriptions",
] as const;

export function isRestrictedCategory(category: MemoryCategory): boolean {
  return RESTRICTED_CATEGORIES.includes(category);
}

// 2. Consent Scopes & Privilege Domains
export type ConsentScope = "local:private" | "briefing:allowed" | "cloud:opt-in-only";

export type RetentionPolicy =
  | "ttl_days"
  | "retain_indefinitely"
  | "ephemeral_session"
  | "rolling_compaction";

export type ContextPrivilege =
  | "low_privilege"     // e.g., commute queries, general tasks, weather
  | "daily_planning"    // morning briefing, calendar, commitments
  | "health_wellness"   // restricted health notes & wellness logs
  | "financial"         // restricted purchases, subscriptions, banking
  | "system_admin";     // full administrative & cryptographic export

// Mapping of Context Privilege to Allowed Memory Categories
export const PRIVILEGE_CATEGORY_MAP: Record<ContextPrivilege, readonly MemoryCategory[]> = {
  low_privilege: ["preferences", "routines", "projects", "commitments", "recurring_problems"],
  daily_planning: [
    "people",
    "preferences",
    "routines",
    "projects",
    "commitments",
    "documents",
    "recurring_problems",
    "subscriptions", // Only due dates & billing cadences, strictly vetted
  ],
  health_wellness: ["health_notes", "routines", "preferences", "people"],
  financial: ["purchases", "subscriptions", "commitments", "projects"],
  system_admin: MEMORY_CATEGORIES,
};

// 3. Memory Atom Metadata & Payload
export interface MemoryAtom {
  memory_id: string;              // UUIDv7 (time-ordered, collision-resistant)
  category: MemoryCategory;       // Strict enum matching the 10 defined categories
  content: string;                // Plaintext memory payload (or decrypted payload in memory)
  source: string;                 // Strict URI/Provenance pointer (e.g. email:msg_9871, calendar:event_102)
  timestamp: string;              // ISO 8601 UTC capture time
  confidence: number;             // Calibrated epistemic score float (0.0 <= c <= 1.0)
  consent_scope: ConsentScope;    // Explicit permission domain
  retention_policy: RetentionPolicy;
  retention_ttl_days?: number | null;
  is_encrypted: boolean;          // Mandatory true for health_notes, purchases, subscriptions
  superseded_by?: string | null;  // UUIDv7 of newer memory atom that overrides this record
  is_deprecated?: boolean;        // Flag indicating this memory has been superseded or invalidated
  metadata?: Record<string, unknown>;
}

// Database record representation (where sensitive content may be encrypted ciphertext)
export interface StoredMemoryRow {
  memory_id: string;
  category: string;
  content: string;
  source: string;
  timestamp: string;
  confidence: number;
  consent_scope: string;
  retention_policy: string;
  retention_ttl_days: number | null;
  is_encrypted: number;
  superseded_by: string | null;
  is_deprecated: number;
  metadata: string | null;
}

// 4. Cryptographic Envelope & Key Vault Types
export interface EncryptedPayload {
  key_id: string;
  algorithm: "aes-256-gcm";
  iv: string;         // Base64 encoded 96-bit (12 byte) IV
  auth_tag: string;   // Base64 encoded 128-bit (16 byte) Auth Tag
  ciphertext: string; // Base64 encoded ciphertext
}

export interface KeyVaultEntry {
  key_id: string;
  encrypted_dek: string; // Base64 encoded Data Encryption Key encrypted by KEK
  dek_iv: string;        // Base64 encoded IV for DEK encryption
  dek_auth_tag: string;  // Base64 encoded Auth Tag for DEK encryption
  created_at: string;
  shredded_at?: string | null;
}

// 5. Embeddings & Vectors
export interface MemoryVector {
  memory_id: string;
  embedding: Float32Array;
  dimensions: number;
  model: string;
  created_at: string;
}

export interface VectorEmbeddingResult {
  embedding: Float32Array;
  dimensions: number;
  model: string;
  isLocal: boolean;
}

// 6. Hybrid Retrieval Engine Contracts
export interface RetrievalQuery {
  query: string;
  privilege_context: ContextPrivilege;
  allowed_categories?: MemoryCategory[];
  min_confidence?: number;          // Default 0.70 (Epistemic Refusal Protocol threshold)
  limit?: number;
  apply_freshness_decay?: boolean;
  decay_lambda?: number;            // Default 0.05 per day
  reference_time?: Date;            // Defaults to now
}

export interface ScoredMemoryResult {
  memory: MemoryAtom;
  vector_score: number;
  lexical_score: number;
  hybrid_score: number;
  decay_multiplier: number;
  citation: string;                 // [mem:<category>:<memory_id>]
}

export interface EpistemicRefusal {
  refusal: true;
  reason: string;
  threshold: number;
  max_found_confidence: number;
  required_clarification: string;
}

export type RetrievalResponse =
  | { refusal: false; results: ScoredMemoryResult[] }
  | EpistemicRefusal;

// 7. Human-in-the-Loop (HITL) Actuation Proposal & Approval Tickets
export type ImpactLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TicketStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED_EXPIRED"
  | "REJECTED_EXPLICIT"
  | "EXECUTED";

export interface ActuationProposal {
  proposal_id: string;             // UUIDv7
  target_tool: string;             // e.g., 'send_email', 'process_payment', 'delete_record'
  parameters: Record<string, unknown>;
  rationale: string;
  impact_level: ImpactLevel;
  reversible: boolean;
  cited_memories: string[];        // Must cite [mem:<category>:<id>] records justifying action
  created_at: string;
}

export interface ApprovalTicket {
  ticket_id: string;               // UUIDv7
  proposal_id: string;
  hmac_signature: string;          // Cryptographic signature over proposal fields & expiry
  created_at: string;
  expires_at: string;              // 15-minute TTL
  status: TicketStatus;
  decision_at?: string | null;
  decision_actor?: string | null;
}

// 8. Daily Life OS Briefing & Weekly Review Synthesis
export interface OneBestNextAction {
  task_name: string;
  rationale: string;
  priority_score: number;
  energy_match: "HIGH_FOCUS" | "MEDIUM_FOCUS" | "LOW_FOCUS";
  deadline_proximity_hours: number | null;
  dependencies: string[];
  cited_memories: string[];        // [mem:<category>:<id>]
}

export interface DailyBriefing {
  briefing_id: string;
  date: string;
  scheduled_calendar_events: Array<{ summary: string; time: string; citation: string }>;
  pending_tasks: Array<{ task: string; due: string | null; citation: string }>;
  urgent_communications: Array<{ sender: string; subject: string; citation: string }>;
  bills_due_48h: Array<{ service: string; amount: string; due_date: string; citation: string }>;
  local_weather_forecast: { summary: string; citation: string };
  anticipated_commute_friction: { route: string; risk: string; citation: string } | null;
  unresolved_prior_jobs: Array<{ job: string; citation: string }>;
  one_best_next_action: OneBestNextAction;
  all_cited_memories: string[];
}

export interface AutomationProposal {
  problem_pattern: string;
  occurrence_count: number;
  proposed_rule: string;
  reversible: boolean;
  cited_memories: string[];
}

export interface WeeklyReview {
  review_id: string;
  week_ending: string;
  work_completed_vs_planned: { completed: number; planned: number; summary: string; citations: string[] };
  overdue_milestones: Array<{ milestone: string; days_overdue: number; citation: string }>;
  financial_expenditure_alerts: Array<{ alert: string; citation: string }>;
  recurring_friction_points: Array<{ friction: string; count: number; citation: string }>;
  opt_in_automation_proposals: AutomationProposal[];
  all_cited_memories: string[];
}
