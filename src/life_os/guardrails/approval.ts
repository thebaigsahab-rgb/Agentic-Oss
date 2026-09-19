/**
 * Zero-Trust Human-In-The-Loop (HITL) Actuation Guardrail Gateway
 * Enforces:
 * 1. Zero Direct Actuation: Outbound communication, payments, and data mutation strictly blocked.
 * 2. Cryptographic Action Proposals with ephemeral HMAC-SHA256 tickets.
 * 3. 15-Minute Expiration TTL with deterministic auto-transition to REJECTED_EXPIRED.
 * 4. Immutable state machine gating all side effects behind out-of-band human approvals.
 */

import { createHmac, randomBytes } from "node:crypto";
import {
  ActuationProposal,
  ApprovalTicket,
  ImpactLevel,
  TicketStatus,
} from "../../memory/types";
import { generateUUIDv7 } from "../../memory/crypto/uuid";

export class SecurityGuardrailViolationError extends Error {
  public readonly ticketId?: string;
  public readonly targetTool?: string;

  constructor(message: string, ticketId?: string, targetTool?: string) {
    super(`HITL Security Violation: ${message}`);
    this.name = "SecurityGuardrailViolationError";
    this.ticketId = ticketId;
    this.targetTool = targetTool;
  }
}

export interface ProposalInput {
  target_tool: string;
  parameters: Record<string, unknown>;
  rationale: string;
  impact_level: ImpactLevel;
  reversible: boolean;
  cited_memories: string[];
}

export class HITLApprovalGateway {
  private readonly hmacSecret: Buffer;
  private readonly ttlMinutes: number = 15;
  private readonly proposals: Map<string, ActuationProposal> = new Map();
  private readonly tickets: Map<string, ApprovalTicket> = new Map();

  constructor(secret?: string) {
    this.hmacSecret = secret
      ? Buffer.from(secret, "utf-8")
      : randomBytes(32);
  }

  /**
   * Computes an immutable HMAC-SHA256 signature for a ticket proposal binding.
   */
  private computeSignature(
    ticketId: string,
    proposalId: string,
    targetTool: string,
    impactLevel: string,
    expiresAt: string
  ): string {
    const payload = `${ticketId}:${proposalId}:${targetTool}:${impactLevel}:${expiresAt}`;
    return createHmac("sha256", this.hmacSecret).update(payload).digest("hex");
  }

  /**
   * Creates an actuation proposal and generates an ephemeral cryptographic approval ticket.
   */
  public createProposal(input: ProposalInput): {
    proposal: ActuationProposal;
    ticket: ApprovalTicket;
  } {
    const proposalId = generateUUIDv7();
    const ticketId = generateUUIDv7();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMinutes * 60 * 1000);

    const proposal: ActuationProposal = {
      proposal_id: proposalId,
      target_tool: input.target_tool,
      parameters: input.parameters,
      rationale: input.rationale,
      impact_level: input.impact_level,
      reversible: input.reversible,
      cited_memories: input.cited_memories,
      created_at: createdAt.toISOString(),
    };

    const signature = this.computeSignature(
      ticketId,
      proposalId,
      proposal.target_tool,
      proposal.impact_level,
      expiresAt.toISOString()
    );

    const ticket: ApprovalTicket = {
      ticket_id: ticketId,
      proposal_id: proposalId,
      hmac_signature: signature,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: "PENDING",
      decision_at: null,
      decision_actor: null,
    };

    this.proposals.set(proposalId, proposal);
    this.tickets.set(ticketId, ticket);

    return { proposal, ticket };
  }

  /**
   * Returns ticket status, automatically transitioning to REJECTED_EXPIRED if TTL has lapsed.
   */
  public getTicket(ticketId: string): ApprovalTicket | null {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return null;

    if (ticket.status === "PENDING") {
      const now = new Date();
      if (now.getTime() > new Date(ticket.expires_at).getTime()) {
        ticket.status = "REJECTED_EXPIRED";
        ticket.decision_at = now.toISOString();
        ticket.decision_actor = "system:ttl_watchdog";
      }
    }

    return ticket;
  }

  /**
   * Explicit out-of-band human authorization (e.g., APPROVE <ticket_id>).
   */
  public approveTicket(
    ticketId: string,
    actor = "user:human_in_the_loop"
  ): ApprovalTicket {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new SecurityGuardrailViolationError(`Approval ticket '${ticketId}' does not exist.`);
    }

    if (ticket.status === "REJECTED_EXPIRED") {
      throw new SecurityGuardrailViolationError(
        `Approval ticket '${ticketId}' has expired and cannot be approved. Create a new proposal.`,
        ticketId
      );
    }

    if (ticket.status !== "PENDING") {
      throw new SecurityGuardrailViolationError(
        `Approval ticket '${ticketId}' cannot be approved from current state '${ticket.status}'.`,
        ticketId
      );
    }

    // Verify cryptographic integrity
    const proposal = this.proposals.get(ticket.proposal_id);
    if (!proposal) {
      throw new SecurityGuardrailViolationError(
        `Corrupted ticket: Associated proposal '${ticket.proposal_id}' missing.`
      );
    }

    const expectedSig = this.computeSignature(
      ticket.ticket_id,
      proposal.proposal_id,
      proposal.target_tool,
      proposal.impact_level,
      ticket.expires_at
    );

    if (ticket.hmac_signature !== expectedSig) {
      throw new SecurityGuardrailViolationError(
        "Cryptographic signature mismatch. Ticket may have been tampered with.",
        ticketId
      );
    }

    ticket.status = "APPROVED";
    ticket.decision_at = new Date().toISOString();
    ticket.decision_actor = actor;

    return ticket;
  }

  /**
   * Explicit human rejection.
   */
  public rejectTicket(
    ticketId: string,
    actor = "user:human_in_the_loop"
  ): ApprovalTicket {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new SecurityGuardrailViolationError(`Approval ticket '${ticketId}' does not exist.`);
    }

    ticket.status = "REJECTED_EXPLICIT";
    ticket.decision_at = new Date().toISOString();
    ticket.decision_actor = actor;

    return ticket;
  }

  /**
   * Gated tool actuation executor.
   * Under no circumstances can executorFn be invoked without an APPROVED, non-expired ticket.
   */
  public async executeGatedActuation<T>(
    ticketId: string,
    executorFn: (proposal: ActuationProposal) => Promise<T> | T
  ): Promise<T> {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new SecurityGuardrailViolationError(
        `Actuation blocked: ticket '${ticketId}' not found. Direct execution forbidden.`,
        ticketId
      );
    }

    const proposal = this.proposals.get(ticket.proposal_id);
    if (!proposal) {
      throw new SecurityGuardrailViolationError(
        `Actuation blocked: proposal '${ticket.proposal_id}' not found.`,
        ticketId
      );
    }

    // Verify Status
    if (ticket.status === "PENDING") {
      throw new SecurityGuardrailViolationError(
        `Execution refused: Action '${proposal.target_tool}' is halted pending human approval ticket '${ticketId}'.`,
        ticketId,
        proposal.target_tool
      );
    }

    if (ticket.status === "REJECTED_EXPIRED") {
      throw new SecurityGuardrailViolationError(
        `Execution refused: Approval ticket '${ticketId}' has expired.`,
        ticketId,
        proposal.target_tool
      );
    }

    if (ticket.status === "REJECTED_EXPLICIT") {
      throw new SecurityGuardrailViolationError(
        `Execution refused: Approval ticket '${ticketId}' was explicitly rejected by user.`,
        ticketId,
        proposal.target_tool
      );
    }

    if (ticket.status === "EXECUTED") {
      throw new SecurityGuardrailViolationError(
        `Execution refused: Approval ticket '${ticketId}' has already been executed (replay attack prevention).`,
        ticketId,
        proposal.target_tool
      );
    }

    if (ticket.status !== "APPROVED") {
      throw new SecurityGuardrailViolationError(
        `Execution refused: Ticket status '${ticket.status}' is not APPROVED.`,
        ticketId,
        proposal.target_tool
      );
    }

    // Mark as EXECUTED to prevent replay
    ticket.status = "EXECUTED";

    return await executorFn(proposal);
  }
}
