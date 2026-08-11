/**
 * The escalation gate.
 *
 * This is the reason it is safe to let an agent speak for you. An agent that
 * can say anything on your behalf is a liability; an agent that stops at a
 * well-defined fence and hands back to you is a tool. Everything in here runs
 * deterministically, before a turn is accepted — we do not ask a model whether
 * it should have escalated, because a model that is about to overstep is
 * exactly the wrong thing to consult about overstepping.
 *
 * Bias is deliberately toward false positives. An unnecessary escalation costs
 * a human ten seconds. A missed one costs a commitment they never made.
 */

import type { Escalation, EscalationTrigger, Persona } from "./types.js";
import { sentences, snippet, uniq, words } from "./text.js";

export interface EscalationHit {
  trigger: EscalationTrigger;
  reason: string;
  evidence: string[];
}

export interface EscalationContext {
  /** True when the counterpart is outside the seat owner's organization. */
  counterpartIsExternal?: boolean;
  /** Agent's own confidence in its turn, 0..1. Below 0.4 escalates. */
  confidence?: number;
  /** Agent explicitly asked to hand off. Always honoured. */
  requestedByAgent?: boolean;
}

const MONEY_RE =
  /(?:\$\s?([\d,]+(?:\.\d{1,2})?)\s*([kKmM]|thousand|million)?|\b([\d,]+(?:\.\d{1,2})?)\s*(?:usd|dollars|eur|euros|gbp|pounds)\b)/gi;

const COMMIT_VERBS =
  /\b(?:i(?:'|’)?ll|we(?:'|’)?ll|i will|we will|we can|i can|let(?:'|’)?s|happy to|agreed|confirmed|deal|sounds good|works for me|approved|sign(?:ed)? off|commit(?:ted)? to|we(?:'|’)?re in)\b/i;

/**
 * Self-contained commitments: the phrase alone is the promise, so no
 * corroborating verb is needed.
 */
const TIME_COMMITMENT_STRONG = [
  /\b(?:let(?:'|’)?s|we(?:'|’)?ll|i(?:'|’)?ll)\s+(?:meet|sync|hop on|jump on|schedule|book|set up)\b/i,
  /\b(?:i(?:'|’)?ll|we(?:'|’)?ll)\s+have (?:it|that|this)\s+(?:by|done by|ready by|to you by)\b/i,
];

/**
 * Merely temporal: a clock time or a deadline noun. These fire only alongside
 * a commitment verb in the SAME sentence.
 *
 * The looser version of this rule was wrong in a way worth remembering. "The
 * board demo runs Friday at 2pm, so Monday works better" is a refusal that
 * commits nothing, yet a bare `\d(am|pm)` match escalated it. Nearly every
 * scheduling message mentions a time, so the gate fired constantly — and a
 * gate that fires constantly is one users learn to click through, which costs
 * more safety than the extra coverage ever bought.
 */
const TIME_COMMITMENT_WEAK = [
  /\b(?:by|before|no later than)\s+(?:end of (?:day|week|month|quarter)|eod|eow|next \w+day|\w+day|\d{1,2}\/\d{1,2}|Q[1-4])\b/i,
  /\b(?:deadline|due date|ship date|go[- ]live)\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
];

const SCOPE_COMMITMENT_RE = [
  /\b(?:we|i)(?:'|’)?ll\s+(?:add|build|include|take (?:that|this|it) on|handle|own|deliver|support|implement)\b/i,
  /\b(?:yes|sure|absolutely),?\s+(?:we|i)\s+(?:can|will)\b/i,
  /\b(?:that(?:'|’)?s|this is)\s+(?:in|within)\s+scope\b/i,
  /\bwe(?:'|’)?ll\s+(?:prioriti[sz]e|slot (?:that|this) in|fit (?:that|this) in)\b/i,
];

const LEGAL_TERMS = [
  "contract", "contracts", "contractual", "nda", "non-disclosure", "sla", "msa",
  "terms of service", "liability", "indemnity", "indemnify", "indemnification",
  "warranty", "penalty", "breach", "lawsuit", "legal counsel", "attorney",
  "litigation", "arbitration", "governing law", "intellectual property",
  "assignment of rights", "termination clause", "statement of work",
  "purchase order", "invoice terms", "net 30", "net 60",
];

const SECRET_TERMS = [
  "password", "passphrase", "api key", "secret key", "access token",
  "private key", "credential", "ssh key", "connection string", "bearer token",
];

/** Shapes of real credentials. Matching these must block the turn outright. */
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bpostgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i,
];

const CONFLICT_TERMS = [
  "disappointed", "unacceptable", "frustrated", "frustrating",
  "this is the third time", "escalate to your manager", "escalate this to",
  "loop in your manager", "take this offline", "concerns about your",
  "performance issue", "not happy", "let down", "i'm upset", "i am upset",
  "this is unacceptable", "losing confidence", "last straw", "formal complaint",
  "hr", "resign", "quitting", "terminate your", "legal action",
];

function toUsd(amount: string, suffix: string | undefined): number {
  const base = Number(amount.replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  const s = (suffix ?? "").toLowerCase();
  if (s === "k" || s === "thousand") return base * 1_000;
  if (s === "m" || s === "million") return base * 1_000_000;
  return base;
}

/** All monetary figures mentioned, normalized to a number. */
export function extractAmounts(text: string): Array<{ raw: string; usd: number }> {
  const out: Array<{ raw: string; usd: number }> = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const raw = m[0].trim();
    const usd = m[1] !== undefined ? toUsd(m[1], m[2]) : toUsd(m[3] ?? "0", undefined);
    if (usd > 0) out.push({ raw, usd });
  }
  return out;
}

function anyMatch(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) hits.push(snippet(m[0], 60));
  }
  return hits;
}

/**
 * Match patterns only inside sentences that also carry a commitment verb.
 *
 * Sentence scoping is what separates "we'll approve the $90k" from "their quote
 * came in at $90k, which is why I'm saying no". Proximity is a crude proxy for
 * intent, but it is a far better one than presence-anywhere-in-the-message.
 */
function committedMatch(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const sentence of sentences(text)) {
    if (!COMMIT_VERBS.test(sentence)) continue;
    for (const re of patterns) {
      const m = sentence.match(re);
      if (m) hits.push(snippet(m[0], 60));
    }
  }
  return uniq(hits);
}

/** Monetary figures appearing in a sentence that also commits to something. */
function committedAmounts(text: string): Array<{ raw: string; usd: number }> {
  const out: Array<{ raw: string; usd: number }> = [];
  for (const sentence of sentences(text)) {
    if (!COMMIT_VERBS.test(sentence)) continue;
    out.push(...extractAmounts(sentence));
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary term matching.
 *
 * Plain substring search was wrong here in a way that took a live run to
 * notice: "nda" matched inside "Monday", so declining a meeting escalated as
 * contractual language. "hr" inside "three" and "sla" inside "translate" were
 * the same bug waiting to happen. Boundaries on both ends, always.
 */
function containsTerms(text: string, terms: string[]): string[] {
  const hay = text.toLowerCase();
  return terms.filter((t) => new RegExp(`\\b${escapeRe(t)}\\b`).test(hay));
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "be", "do", "not", "no", "never", "any", "my", "our", "i", "we",
  "that", "this", "it", "as", "at", "by", "from", "about", "into", "over",
]);

/**
 * Free-text boundaries ("never agree to weekend work") cannot be regexed, so we
 * check content-word overlap. A boundary fires when most of its meaningful
 * words appear in the turn. Crude, and tuned to over-trigger rather than miss.
 */
function boundaryFires(boundary: string, text: string): boolean {
  const keys = uniq(
    words(boundary)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
  if (keys.length === 0) return false;
  const hay = new Set(words(text).map((w) => w.toLowerCase()));
  const hitCount = keys.filter((k) => hay.has(k)).length;
  return hitCount / keys.length >= 0.6;
}

/**
 * Evaluate whether a proposed turn must be handed back to its human.
 *
 * Returns every trigger that fired, not just the first, because the human
 * deserves to see the full reason they are being pulled in.
 */
export function evaluateEscalation(
  content: string,
  persona: Persona,
  ctx: EscalationContext = {},
): EscalationHit[] {
  const hits: EscalationHit[] = [];
  const auth = persona.authority;

  // ── Secrets. Checked first and never gated on authority: there is no
  //    configuration under which an agent should relay a live credential.
  const secretShapes = SECRET_SHAPES.filter((re) => re.test(content)).map(() => "[redacted]");
  const secretWords = containsTerms(content, SECRET_TERMS);
  if (secretShapes.length > 0 || secretWords.length > 0) {
    hits.push({
      trigger: "credentials_or_secrets",
      reason:
        secretShapes.length > 0
          ? "This turn appears to contain a live credential. It was not sent."
          : "This turn discusses credentials. A human should decide what gets shared.",
      evidence: secretShapes.length > 0 ? ["credential-shaped string detected"] : secretWords,
    });
  }

  // ── Money above the authority ceiling, but only where it is being agreed to.
  const overCap = committedAmounts(content).filter((a) => a.usd > auth.canCommitMoneyUsd);
  if (overCap.length > 0) {
    hits.push({
      trigger: "money_over_authority",
      reason:
        auth.canCommitMoneyUsd === 0
          ? `Your agent is not authorized to discuss money, and this turn commits to ${overCap[0]!.raw}.`
          : `This turn commits to ${overCap[0]!.raw}, above your ceiling of $${auth.canCommitMoneyUsd.toLocaleString()}.`,
      evidence: overCap.map((a) => a.raw).slice(0, 4),
    });
  }

  // ── Calendar and deadline commitments.
  if (!auth.canCommitTime) {
    const timeHits = [
      ...anyMatch(content, TIME_COMMITMENT_STRONG),
      ...committedMatch(content, TIME_COMMITMENT_WEAK),
    ];
    if (timeHits.length > 0) {
      hits.push({
        trigger: "time_commitment",
        reason: "This turn commits your time. Your agent is not authorized to do that.",
        evidence: timeHits.slice(0, 4),
      });
    }
  }

  // ── Scope commitments on work you own.
  if (!auth.canCommitScope) {
    const scopeHits = anyMatch(content, SCOPE_COMMITMENT_RE);
    if (scopeHits.length > 0) {
      hits.push({
        trigger: "scope_commitment",
        reason: "This turn agrees to take on work. Your agent is not authorized to do that.",
        evidence: scopeHits.slice(0, 4),
      });
    }
  }

  // ── Talking to outsiders.
  if (ctx.counterpartIsExternal && !auth.canSpeakExternally) {
    hits.push({
      trigger: "external_party",
      reason: "The counterpart is outside your organization and your agent is internal-only.",
      evidence: [],
    });
  }

  // ── Anything a lawyer would want to see first.
  const legal = containsTerms(content, LEGAL_TERMS);
  if (legal.length > 0) {
    hits.push({
      trigger: "legal_or_contractual",
      reason: "This turn touches contractual language. Agents do not get to bind you.",
      evidence: legal.slice(0, 5),
    });
  }

  // ── Conflict. An agent smoothing over a real interpersonal problem is the
  //    worst possible outcome for this product, so this fence is absolute.
  const conflict = containsTerms(content, CONFLICT_TERMS);
  if (conflict.length > 0) {
    hits.push({
      trigger: "interpersonal_conflict",
      reason:
        "There is emotional or interpersonal content here. This needs you, not your agent.",
      evidence: conflict.slice(0, 5),
    });
  }

  // ── The owner's own stated fences.
  const boundaryHits = [...persona.boundaries, ...persona.escalateOn].filter((b) =>
    boundaryFires(b, content),
  );
  if (boundaryHits.length > 0) {
    hits.push({
      trigger: "persona_boundary",
      reason: "This turn crosses a boundary you set in your persona.",
      evidence: boundaryHits.slice(0, 4),
    });
  }

  if (typeof ctx.confidence === "number" && ctx.confidence < 0.4) {
    hits.push({
      trigger: "low_confidence",
      reason: `Your agent is only ${Math.round(ctx.confidence * 100)}% confident. It stopped rather than guess.`,
      evidence: [],
    });
  }

  if (ctx.requestedByAgent) {
    hits.push({
      trigger: "explicit_request",
      reason: "Your agent asked to hand this back to you.",
      evidence: [],
    });
  }

  return hits;
}

/** True when a turn must not be delivered as-is. */
export function mustEscalate(hits: EscalationHit[]): boolean {
  return hits.length > 0;
}

/**
 * Triggers that block delivery outright rather than merely flagging. Secrets
 * are the only category where the text itself is the hazard.
 */
export function isBlocking(hit: EscalationHit): boolean {
  return hit.trigger === "credentials_or_secrets";
}

export function toEscalation(
  hit: EscalationHit,
  args: { id: string; duelId: string; seat: Escalation["seat"]; now: string },
): Escalation {
  return {
    id: args.id,
    duelId: args.duelId,
    seat: args.seat,
    trigger: hit.trigger,
    reason: hit.reason,
    evidence: hit.evidence,
    raisedAt: args.now,
    resolvedAt: null,
  };
}
