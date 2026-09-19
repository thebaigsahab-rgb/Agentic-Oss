/**
 * Weekly Review & Friction Engine
 * Synthesizes:
 * 1. Work completed vs. planned and overdue milestones.
 * 2. Financial expenditure alerts (subscriptions renewing, budget deviations).
 * 3. Recurring friction analysis from recurring_problems memories.
 * 4. Opt-in automation suggestions for frequent friction points (occurrence >= 2).
 * 5. Strict citation grounding invariant [mem:<category>:<memory_id>].
 */

import {
  AutomationProposal,
  MemoryAtom,
  WeeklyReview,
} from "../../memory/types";
import { generateUUIDv7 } from "../../memory/crypto/uuid";

export class WeeklyReviewEngine {
  /**
   * Compiles the deterministic Weekly Review and friction analysis.
   */
  public compileWeeklyReview(
    memories: MemoryAtom[],
    weekEnding: Date = new Date()
  ): { review: WeeklyReview; formattedMarkdown: string } {
    const reviewId = generateUUIDv7();
    const weekEndingStr = weekEnding.toISOString().slice(0, 10);
    const allCitedMemories: string[] = [];

    const addCitation = (category: string, id: string) => {
      const cite = `[mem:${category}:${id}]`;
      if (!allCitedMemories.includes(cite)) {
        allCitedMemories.push(cite);
      }
      return cite;
    };

    // 1. Work Completed vs. Planned
    const projectAndCommitmentMemories = memories.filter(
      (m) => m.category === "projects" || m.category === "commitments"
    );

    const completed = projectAndCommitmentMemories.filter(
      (m) => m.metadata?.status === "completed" || m.content.toLowerCase().includes("completed")
    );
    const planned = projectAndCommitmentMemories;

    const workCitations: string[] = [];
    for (const m of projectAndCommitmentMemories) {
      workCitations.push(addCitation(m.category, m.memory_id));
    }

    const work_completed_vs_planned = {
      completed: completed.length,
      planned: planned.length,
      summary: `Completed ${completed.length} of ${planned.length} planned deliverables this week.`,
      citations: workCitations,
    };

    // 2. Overdue Milestones
    const refMs = weekEnding.getTime();
    const overdue_milestones: WeeklyReview["overdue_milestones"] = [];

    for (const m of projectAndCommitmentMemories) {
      const isDone = m.metadata?.status === "completed" || m.content.toLowerCase().includes("completed");
      if (!isDone && m.metadata?.due_date) {
        const dueMs = new Date(String(m.metadata.due_date)).getTime();
        if (dueMs < refMs) {
          const daysOverdue = Math.max(1, Math.round((refMs - dueMs) / (1000 * 60 * 60 * 24)));
          overdue_milestones.push({
            milestone: m.content,
            days_overdue: daysOverdue,
            citation: addCitation(m.category, m.memory_id),
          });
        }
      }
    }

    // 3. Financial Expenditure Alerts
    const financialMemories = memories.filter(
      (m) => m.category === "subscriptions" || m.category === "purchases"
    );
    const financial_expenditure_alerts: WeeklyReview["financial_expenditure_alerts"] = [];

    for (const m of financialMemories) {
      if (m.category === "subscriptions") {
        const citation = addCitation(m.category, m.memory_id);
        financial_expenditure_alerts.push({
          alert: `Subscription active: ${m.content} (Review renewal status)`,
          citation,
        });
      } else if (m.category === "purchases" && m.metadata?.unexpected_charge === true) {
        const citation = addCitation(m.category, m.memory_id);
        financial_expenditure_alerts.push({
          alert: `Budget deviation flagged: ${m.content}`,
          citation,
        });
      }
    }

    // 4. Recurring Friction Points & Automation Proposals
    const frictionMemories = memories.filter((m) => m.category === "recurring_problems");
    const frictionCountMap = new Map<string, { count: number; memories: MemoryAtom[] }>();

    for (const m of frictionMemories) {
      // Group by normalized problem pattern
      const key = (m.metadata?.problem_pattern as string) ?? m.content.toLowerCase().trim();
      const existing = frictionCountMap.get(key) ?? { count: 0, memories: [] };
      existing.count += (m.metadata?.occurrences as number) ?? 1;
      existing.memories.push(m);
      frictionCountMap.set(key, existing);
    }

    const recurring_friction_points: WeeklyReview["recurring_friction_points"] = [];
    const opt_in_automation_proposals: AutomationProposal[] = [];

    for (const [pattern, entry] of frictionCountMap.entries()) {
      const topMem = entry.memories[0];
      const citation = addCitation(topMem.category, topMem.memory_id);

      recurring_friction_points.push({
        friction: topMem.content,
        count: entry.count,
        citation,
      });

      // If friction occurred >= 2 times, formulate an Opt-in Automation Proposal
      if (entry.count >= 2) {
        const proposalCitations = entry.memories.map((mem) =>
          addCitation(mem.category, mem.memory_id)
        );

        opt_in_automation_proposals.push({
          problem_pattern: pattern,
          occurrence_count: entry.count,
          proposed_rule: `Automatically handle '${pattern}' via predefined template/rule without manual intervention.`,
          reversible: true,
          cited_memories: proposalCitations,
        });
      }
    }

    const review: WeeklyReview = {
      review_id: reviewId,
      week_ending: weekEndingStr,
      work_completed_vs_planned,
      overdue_milestones,
      financial_expenditure_alerts,
      recurring_friction_points,
      opt_in_automation_proposals,
      all_cited_memories: allCitedMemories,
    };

    const formattedMarkdown = this.formatReviewMarkdown(review);

    return { review, formattedMarkdown };
  }

  /**
   * Formats weekly review markdown with strict citation grounding.
   */
  public formatReviewMarkdown(review: WeeklyReview): string {
    const lines: string[] = [];

    lines.push(`# Sovereign Weekly Review — Week Ending ${review.week_ending}`);
    lines.push("");

    lines.push("## Work Performance & Deliverables");
    lines.push(
      `- ${review.work_completed_vs_planned.summary} ${review.work_completed_vs_planned.citations.join(
        " "
      )}`
    );
    lines.push("");

    lines.push("## Overdue Milestones");
    if (review.overdue_milestones.length === 0) {
      lines.push("- All planned milestones completed on time.");
    } else {
      for (const m of review.overdue_milestones) {
        lines.push(`- ${m.milestone} [${m.days_overdue} days overdue] ${m.citation}`);
      }
    }
    lines.push("");

    lines.push("## Financial Expenditure Alerts");
    if (review.financial_expenditure_alerts.length === 0) {
      lines.push("- No unexpected financial deviations or renewal alerts this week.");
    } else {
      for (const f of review.financial_expenditure_alerts) {
        lines.push(`- ${f.alert} ${f.citation}`);
      }
    }
    lines.push("");

    lines.push("## Recurring Friction Points & Patterns");
    if (review.recurring_friction_points.length === 0) {
      lines.push("- Zero recurring friction points recorded this week.");
    } else {
      for (const p of review.recurring_friction_points) {
        lines.push(`- ${p.friction} (Logged ${p.count} times) ${p.citation}`);
      }
    }
    lines.push("");

    lines.push("## Opt-In Automation Proposals");
    if (review.opt_in_automation_proposals.length === 0) {
      lines.push("- No recurring friction met threshold (>= 2 occurrences) for automation.");
    } else {
      for (const a of review.opt_in_automation_proposals) {
        lines.push(
          `- **Proposed Automation**: ${a.proposed_rule} (Observed: ${
            a.occurrence_count
          } times) ${a.cited_memories.join(" ")}`
        );
      }
    }
    lines.push("");

    return lines.join("\n");
  }
}
