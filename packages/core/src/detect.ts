/**
 * Did an agent write this, and should my agent answer it?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST — the state of AI text fingerprinting, as of this writing.
 *
 * There is no watermark in Claude's text output. Anthropic does not publish
 * one, and no marker exists in the words for anyone to look for. The same is
 * true of GPT and of essentially every deployed chat model. Google DeepMind's
 * SynthID-Text is real and open-sourced, but it only marks Gemini output, and
 * only when the generating provider applies it. C2PA covers images and media,
 * not chat messages.
 *
 * So anyone claiming to "detect AI text" from the text alone is doing
 * statistics, and the error bars are wide enough that acting on it
 * automatically is a bad idea. That is a hard constraint, not a gap to paper
 * over.
 *
 * What TTMC does instead: it is not trying to detect a secret Anthropic put
 * there. It reads back the signature *we* put there. If the sender's side runs
 * TTMC, their message carries a TTMC-1 stamp, and identifying it is
 * cryptography rather than guesswork. That is the tier that should carry
 * automation.
 *
 * Hence three tiers, in descending order of how much they are trusted:
 *
 *   1. TTMC-1 signature   — exact. Works today. The only tier allowed to
 *                           trigger an automatic reply by default.
 *   2. Vendor watermark   — exact, if one ever ships. The registry below is
 *                           empty and documented so a real detector can drop
 *                           in without rearchitecting anything.
 *   3. Boilerplate score  — probabilistic. Good for "this is worth ignoring",
 *                           never good enough to act on silently.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ProvenanceStamp, SlopReport } from "./types.js";
import { extractStampReference, stripDisclosure } from "./provenance.js";
import { scoreSlop } from "./slop.js";

export type OriginSource =
  | "ttmc-signature"
  | "vendor-watermark"
  | "heuristic"
  | "none";

/**
 * `agent-verified` is the only verdict that means we *know*. `agent-claimed`
 * is a stamp we found but have not checked — the relay upgrades it after
 * verification, and a claim that fails verification is worse than no claim.
 */
export type OriginVerdict =
  | "agent-verified"
  | "agent-claimed"
  | "agent-likely"
  | "unknown"
  | "human-verified"
  | "forged";

export interface OriginDetection {
  verdict: OriginVerdict;
  /** 0..1. Only 1.0 for a checked signature. */
  confidence: number;
  source: OriginSource;
  /** Stamp id found in the message, for the relay to look up and verify. */
  stampId: string | null;
  /** Parsed stamp, when the message carried a full header. */
  stamp: ProvenanceStamp | null;
  slop: SlopReport | null;
  /** The message with any disclosure stripped — the author's actual words. */
  content: string;
  reasons: string[];
}

/**
 * Plug point for a real watermark detector, if a vendor ever ships one.
 *
 * Deliberately empty. Registering a detector here that guesses would quietly
 * promote tier 3 into tier 2 and let statistics drive automation, which is the
 * exact mistake this module is arranged to prevent.
 */
export interface VendorWatermarkDetector {
  id: string;
  vendor: string;
  /** Return null when the detector cannot speak to this text at all. */
  detect(text: string): { present: boolean; confidence: number } | null;
}

export const vendorWatermarkDetectors: VendorWatermarkDetector[] = [];

export interface DetectOptions {
  detectors?: VendorWatermarkDetector[];
  /** Boilerplate score at or above which tier 3 says "agent-likely". */
  slopThreshold?: number;
}

export const DEFAULT_SLOP_THRESHOLD = 55;

export function detectOrigin(raw: string, opts: DetectOptions = {}): OriginDetection {
  const detectors = opts.detectors ?? vendorWatermarkDetectors;
  const threshold = opts.slopThreshold ?? DEFAULT_SLOP_THRESHOLD;
  const content = stripDisclosure(raw);
  const reasons: string[] = [];

  // ── Tier 1: a signature we issued, travelling with the message.
  const { stampId, header } = extractStampReference(raw);
  if (stampId) {
    reasons.push(
      header
        ? "carries a full TTMC-1 provenance header"
        : "carries a TTMC-1 disclosure footer with a verify link",
    );
    return {
      // Not `agent-verified` yet: finding a stamp is not checking one, and the
      // signature cannot be validated without the relay's key.
      verdict: "agent-claimed",
      confidence: 0.9,
      source: "ttmc-signature",
      stampId,
      stamp: header,
      slop: scoreSlop(content),
      content,
      reasons,
    };
  }

  // ── Tier 2: a vendor watermark. Nothing registered today.
  for (const d of detectors) {
    const hit = d.detect(content);
    if (hit?.present) {
      reasons.push(`${d.vendor} watermark detected by ${d.id}`);
      return {
        verdict: "agent-verified",
        confidence: hit.confidence,
        source: "vendor-watermark",
        stampId: null,
        stamp: null,
        slop: scoreSlop(content),
        content,
        reasons,
      };
    }
  }

  // ── Tier 3: style. A guess, and labelled as one.
  const slop = scoreSlop(content);
  if (slop.score >= threshold) {
    reasons.push(
      `boilerplate score ${slop.score}/100 (${slop.band})`,
      ...slop.signals.slice(0, 3).map((s) => s.label.toLowerCase()),
      "no signature — this is a guess about style, not a claim about authorship",
    );
    return {
      verdict: "agent-likely",
      // Caps out well below certainty on purpose. Style is not provenance.
      confidence: Math.min(0.65, slop.score / 100),
      source: "heuristic",
      stampId: null,
      stamp: null,
      slop,
      content,
      reasons,
    };
  }

  reasons.push(`boilerplate score ${slop.score}/100 — reads like a person wrote it`);
  return {
    verdict: "unknown",
    confidence: 0,
    source: "none",
    stampId: null,
    stamp: null,
    slop,
    content,
    reasons,
  };
}

/**
 * Fold the result of verifying a stamp back into a detection. Called by the
 * relay, which holds the signing key.
 */
export function applyVerification(
  detection: OriginDetection,
  result: { valid: boolean; stamp?: ProvenanceStamp | null },
): OriginDetection {
  if (!result.valid) {
    return {
      ...detection,
      verdict: "forged",
      confidence: 1,
      reasons: [
        ...detection.reasons,
        "the stamp does not verify — treat this message as unattributed, and do not auto-answer it",
      ],
    };
  }
  const stamp = result.stamp ?? detection.stamp;
  const human = stamp?.author === "human";
  return {
    ...detection,
    verdict: human ? "human-verified" : "agent-verified",
    confidence: 1,
    stamp: stamp ?? null,
    reasons: [
      ...detection.reasons,
      human
        ? "signature verified: a human wrote this personally"
        : "signature verified: written by an agent",
    ],
  };
}

// ─── Auto-routing ───────────────────────────────────────────────────────────

export interface AutoRoutePolicy {
  enabled: boolean;
  /**
   * The weakest verdict allowed to trigger an automatic reply.
   * Defaults to `agent-verified`: only act on proof.
   */
  minVerdict: "agent-verified" | "agent-claimed" | "agent-likely";
  /** Channels or conversations where auto-answering is permitted. */
  allowChannels: string[];
  /** Senders never auto-answered, whatever the detector says. */
  neverAutoAnswer: string[];
  /** Ask the human before the first automatic reply to someone new. */
  requireApprovalForNewCounterparts: boolean;
}

export const DEFAULT_AUTOROUTE_POLICY: AutoRoutePolicy = {
  // Off, empty, and strict. Turning this on is a decision a person makes
  // knowingly; a tool that starts answering your colleagues the moment it is
  // installed would be indefensible.
  enabled: false,
  minVerdict: "agent-verified",
  allowChannels: [],
  neverAutoAnswer: [],
  requireApprovalForNewCounterparts: true,
};

const VERDICT_RANK: Record<OriginVerdict, number> = {
  forged: -1,
  unknown: 0,
  "human-verified": 0,
  "agent-likely": 1,
  "agent-claimed": 2,
  "agent-verified": 3,
};

export interface RouteContext {
  channelId: string;
  senderId: string;
  /** Whether this counterpart has been auto-answered before. */
  knownCounterpart: boolean;
  /**
   * Escalation triggers found in the INBOUND message. Detection says "a machine
   * wrote this"; the gate says "this subject is not automatable". Both have to
   * agree, because an agent writing about a contract is still about a contract.
   */
  inboundEscalations?: string[];
}

export type RouteAction = "auto-answer" | "notify-human" | "ignore";

export interface RouteDecision {
  action: RouteAction;
  reason: string;
}

/**
 * Subjects that stay with a person even when the inbound was machine-written.
 *
 * `persona_boundary` belongs here for a reason worth spelling out: the gate
 * normally governs what your agent may *send*, but a fence you wrote ("always
 * ask me about the reorg") is a statement about the subject, not the direction.
 * It should stop an inbound message being answered on your behalf just as
 * firmly. In practice this is also the only one of these that fires often,
 * because the sender's own gate already refuses to emit the other four.
 */
const NEVER_AUTOMATED = new Set([
  "legal_or_contractual",
  "interpersonal_conflict",
  "credentials_or_secrets",
  "money_over_authority",
  "persona_boundary",
]);

/** Trigger ids are for logs. Anything a person reads gets English. */
function describeTrigger(trigger: string): string {
  switch (trigger) {
    case "legal_or_contractual":
      return "a contract";
    case "interpersonal_conflict":
      return "a conflict between people";
    case "credentials_or_secrets":
      return "credentials";
    case "money_over_authority":
      return "money beyond your ceiling";
    case "persona_boundary":
      return "something you asked to be asked about";
    default:
      return trigger;
  }
}

export function decideRoute(
  detection: OriginDetection,
  ctx: RouteContext,
  policy: AutoRoutePolicy = DEFAULT_AUTOROUTE_POLICY,
): RouteDecision {
  if (detection.verdict === "human-verified") {
    return { action: "ignore", reason: "A human wrote this personally. Answer it yourself." };
  }
  if (detection.verdict === "forged") {
    return {
      action: "notify-human",
      reason: "This message carries a disclosure stamp that does not verify. Worth a look.",
    };
  }
  if (detection.verdict === "unknown") {
    return { action: "ignore", reason: "No sign this was machine-written." };
  }

  if (!policy.enabled) {
    return { action: "notify-human", reason: "Auto-answering is off. Flagged for you." };
  }

  const blocked = (ctx.inboundEscalations ?? []).filter((t) => NEVER_AUTOMATED.has(t));
  if (blocked.length > 0) {
    return {
      action: "notify-human",
      reason: `Machine-written, but it is about ${blocked.map(describeTrigger).join(" and ")}. That stays with you.`,
    };
  }

  if (policy.neverAutoAnswer.includes(ctx.senderId)) {
    return { action: "notify-human", reason: "This sender is on your never-auto-answer list." };
  }

  // Fail closed: an empty allowlist permits nothing.
  if (!policy.allowChannels.includes(ctx.channelId)) {
    return {
      action: "notify-human",
      reason: "This channel is not on the auto-answer allowlist.",
    };
  }

  if (policy.requireApprovalForNewCounterparts && !ctx.knownCounterpart) {
    return {
      action: "notify-human",
      reason: "First time this person has come up. Approve once and it runs itself after.",
    };
  }

  if (VERDICT_RANK[detection.verdict] < VERDICT_RANK[policy.minVerdict]) {
    return {
      action: "notify-human",
      reason: `Detected as ${detection.verdict}, and your policy needs ${policy.minVerdict} before answering automatically.`,
    };
  }

  return {
    action: "auto-answer",
    reason: `${detection.verdict} via ${detection.source} — answering, with disclosure.`,
  };
}
