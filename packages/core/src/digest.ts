/**
 * The digest — the compressed artifact a human is actually expected to read.
 *
 * If an exchange does not shrink, the product has failed. Every other AI
 * feature in your inbox generates more text than it consumes; the entire point
 * of this one is to run the arrow backwards. `compressionRatio` is the number
 * we live or die on, so it is computed here rather than trusted from an agent.
 *
 * The agent proposes the content. This module validates it, drops anything it
 * cannot trace to a real turn, and computes the statistics itself.
 */

import type {
  ActionItem,
  Digest,
  DigestItem,
  DigestStats,
  Duel,
  SeatId,
} from "./types.js";
import { countWords, round } from "./text.js";
import { nowIso } from "./ids.js";

const MAX_ITEMS = 10;
const MAX_HEADLINE_WORDS = 45;

/** Shape an agent submits via the `ttmc_digest` MCP tool. */
export interface DigestDraft {
  headline: string;
  decisions?: Array<{ text: string; sourceTurns?: number[] }>;
  openQuestions?: Array<{ text: string; sourceTurns?: number[] }>;
  actionItems?: Array<{
    text: string;
    owner?: SeatId | "unassigned";
    due?: string | null;
    sourceTurns?: number[];
  }>;
  needsHuman?: string[];
}

export interface DigestProblem {
  field: string;
  message: string;
}

function cleanItems(
  raw: Array<{ text: string; sourceTurns?: number[] }> | undefined,
  validIndices: Set<number>,
): DigestItem[] {
  return (raw ?? [])
    .map((i) => ({
      text: i.text?.trim() ?? "",
      // Citations to turns that do not exist are dropped rather than rejected:
      // a hallucinated reference should not cost the user a real finding, but
      // it must not appear as though it were traceable either.
      sourceTurns: (i.sourceTurns ?? []).filter((n) => validIndices.has(n)),
    }))
    .filter((i) => i.text.length > 0)
    .slice(0, MAX_ITEMS);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build a validated digest and compute its statistics.
 *
 * `problems` is advisory — it surfaces things worth showing the user (an agent
 * that invented a due date, a headline that ran long) without discarding an
 * otherwise useful summary.
 */
export function buildDigest(
  duel: Duel,
  draft: DigestDraft,
  generatedBySeat: SeatId | null,
): { digest: Digest; problems: DigestProblem[] } {
  const problems: DigestProblem[] = [];
  const validIndices = new Set(duel.turns.map((t) => t.index));

  let headline = (draft.headline ?? "").trim();
  if (!headline) {
    headline = `${duel.subject} — ${duel.turns.length} turns, no summary provided.`;
    problems.push({ field: "headline", message: "Agent returned no headline." });
  }
  if (countWords(headline) > MAX_HEADLINE_WORDS) {
    problems.push({
      field: "headline",
      message: `Headline is ${countWords(headline)} words; the cap is ${MAX_HEADLINE_WORDS}.`,
    });
  }

  const decisions = cleanItems(draft.decisions, validIndices);
  const openQuestions = cleanItems(draft.openQuestions, validIndices);

  const actionItems: ActionItem[] = (draft.actionItems ?? [])
    .map((a) => {
      const due = a.due?.trim() || null;
      if (due && !ISO_DATE.test(due)) {
        problems.push({
          field: "actionItems.due",
          message: `Dropped non-ISO due date "${due}". Agents do not get to invent deadlines.`,
        });
      }
      return {
        text: a.text?.trim() ?? "",
        sourceTurns: (a.sourceTurns ?? []).filter((n) => validIndices.has(n)),
        owner: a.owner ?? "unassigned",
        due: due && ISO_DATE.test(due) ? due : null,
      };
    })
    .filter((a) => a.text.length > 0)
    .slice(0, MAX_ITEMS);

  const needsHuman = (draft.needsHuman ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ITEMS);

  // Unresolved escalations always appear here, whatever the agent said. The
  // agent that tripped the gate is not the right judge of whether it matters.
  for (const e of duel.escalations) {
    if (e.resolvedAt === null && !needsHuman.some((n) => n.includes(e.reason))) {
      needsHuman.unshift(e.reason);
    }
  }

  const digest: Digest = {
    duelId: duel.id,
    headline,
    decisions,
    openQuestions,
    actionItems,
    needsHuman: needsHuman.slice(0, MAX_ITEMS),
    stats: computeStats(duel, {
      headline,
      decisions,
      openQuestions,
      actionItems,
      needsHuman,
    }),
    generatedAt: nowIso(),
    generatedBySeat,
  };

  return { digest, problems };
}

type DigestBody = Pick<
  Digest,
  "headline" | "decisions" | "openQuestions" | "actionItems" | "needsHuman"
>;

function bodyWordCount(body: DigestBody): number {
  return (
    countWords(body.headline) +
    body.decisions.reduce((n, i) => n + countWords(i.text), 0) +
    body.openQuestions.reduce((n, i) => n + countWords(i.text), 0) +
    body.actionItems.reduce((n, i) => n + countWords(i.text), 0) +
    body.needsHuman.reduce((n, s) => n + countWords(s), 0)
  );
}

export function computeStats(duel: Duel, body: DigestBody): DigestStats {
  const inboundWords = duel.turns.reduce((n, t) => n + t.wordCount, 0);
  const digestWords = bodyWordCount(body);
  const scored = duel.turns.map((t) => t.slop?.score).filter((s): s is number => s != null);

  return {
    turnCount: duel.turns.length,
    inboundWords,
    digestWords,
    compressionRatio: digestWords > 0 ? round(inboundWords / digestWords, 1) : 0,
    meanSlop:
      scored.length > 0
        ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
        : null,
  };
}

/**
 * Fallback for an exchange that ended without an agent producing a summary —
 * a hit turn cap with nobody connected, usually.
 *
 * It states what is verifiable and nothing else. Fabricating a plausible
 * summary of a conversation nobody read would be the single most damaging
 * thing this product could do, so the fallback stays deliberately thin.
 */
export function fallbackDigest(duel: Duel): Digest {
  const open = duel.escalations.filter((e) => e.resolvedAt === null);
  const headline =
    open.length > 0
      ? `Stopped after ${duel.turns.length} turns: an escalation needs you.`
      : `Ran ${duel.turns.length} turns and ended (${duel.termination ?? "closed"}). No agent summarised it — read the transcript.`;

  const body: DigestBody = {
    headline,
    decisions: [],
    openQuestions: [],
    actionItems: [],
    needsHuman: open.map((e) => e.reason),
  };

  return {
    duelId: duel.id,
    ...body,
    stats: computeStats(duel, body),
    generatedAt: nowIso(),
    generatedBySeat: null,
  };
}

/** Markdown rendering, used for the share page, email, and Slack unfurls. */
export function renderDigestMarkdown(digest: Digest, duel: Duel): string {
  const s = digest.stats;
  const out: string[] = [`## ${duel.subject}`, "", digest.headline, ""];

  if (digest.needsHuman.length > 0) {
    out.push("### Needs you");
    for (const n of digest.needsHuman) out.push(`- ${n}`);
    out.push("");
  }
  if (digest.decisions.length > 0) {
    out.push("### Decided");
    for (const d of digest.decisions) out.push(`- ${d.text}${cite(d)}`);
    out.push("");
  }
  if (digest.actionItems.length > 0) {
    out.push("### Actions");
    for (const a of digest.actionItems) {
      const who = a.owner === "unassigned" ? "unassigned" : duel.seats[a.owner].displayName;
      out.push(`- **${who}**${a.due ? ` (by ${a.due})` : ""}: ${a.text}${cite(a)}`);
    }
    out.push("");
  }
  if (digest.openQuestions.length > 0) {
    out.push("### Still open");
    for (const q of digest.openQuestions) out.push(`- ${q.text}${cite(q)}`);
    out.push("");
  }

  out.push(
    "---",
    `${s.inboundWords} words in → ${s.digestWords} words out (${s.compressionRatio}× compression) over ${s.turnCount} turns.` +
      (s.meanSlop !== null ? ` Mean boilerplate score ${s.meanSlop}/100.` : ""),
  );
  return out.join("\n");
}

function cite(item: DigestItem): string {
  return item.sourceTurns.length > 0 ? ` _(turn ${item.sourceTurns.join(", ")})_` : "";
}
