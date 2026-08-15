/**
 * Did a machine write this, and should my agent answer it?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STATE OF AI TEXT WATERMARKING
 *
 * Anthropic began watermarking Claude's text output with models from
 * 2026-08-14, with older models being backfilled. The scheme is the one from
 * Kirchenbauer et al., "A Watermark for Large Language Models" (arXiv
 * 2301.10226): rather than inserting anything into the text, it replaces the
 * source of randomness used when the model chooses among equally viable next
 * tokens, seeding that choice from a secret key plus the preceding words. In
 * Anthropic's words: "Nothing is added to the text and there are no hidden
 * characters."
 *
 * Two properties of it drive everything below.
 *
 * 1. ONLY THE VENDOR CAN DETECT IT. Detection needs their key. There is no
 *    local check, so this tier is a network call to a vendor endpoint — not a
 *    pure function. Anthropic's detection API was announced as "soon" and its
 *    shape is not yet published, so the detector here is an interface with no
 *    live implementation, configured by URL when one exists.
 *
 * 2. IT PROVES INVOLVEMENT, NOT AUTHORSHIP. Anthropic is explicit: it "can
 *    only determine that Claude was likely involved with the content at some
 *    point," and "cannot distinguish 'Claude wrote this' from 'Claude heavily
 *    edited this.'" Someone who ran their own writing through Claude to fix
 *    the grammar carries the mark.
 *
 *    That second point is a safety constraint, not a footnote. Treating a
 *    watermark hit as authorship would auto-answer a colleague's own words
 *    because they used Claude as an editor — and the people most likely to do
 *    that are non-native English speakers, the same group that naive AI
 *    detectors already treat worst. So a watermark hit gets its own verdict,
 *    `machine-involved`, and does not clear the auto-answer bar by default.
 *
 * Anthropic also notes it works poorly on short samples, and that light editing
 * probably leaves it intact while a full rewrite removes it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * So, four tiers, ordered by what they actually license you to conclude:
 *
 *   1. TTMC-1 signature   — exact, and about AUTHORSHIP. Ours, so we can check
 *                           it ourselves. The only tier that auto-answers by
 *                           default.
 *   2. Vendor watermark   — exact, but only about INVOLVEMENT. Remote call.
 *   3. Boilerplate score  — probabilistic, about STYLE. Never conclusive.
 *   4. Nothing            — which is not evidence of a human. Absence of a
 *                           mark means absence of a mark.
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
 * `agent-verified` is the only verdict that means we know who wrote it.
 * `machine-involved` means a vendor watermark says their model touched the
 * text — which is a different and weaker claim, deliberately kept separate.
 */
export type OriginVerdict =
  | "agent-verified"
  | "agent-claimed"
  | "machine-involved"
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
  watermark: WatermarkFinding | null;
  reasons: string[];
}

// ─── Tier 2: vendor watermarks ──────────────────────────────────────────────

export interface WatermarkFinding {
  vendor: string;
  present: boolean;
  /** Vendor-reported confidence, 0..1. */
  confidence: number;
  /**
   * What a positive result licenses you to say. Every shipping scheme today is
   * `involvement`; the field exists so a future scheme that genuinely attests
   * authorship is not silently treated as the same thing.
   */
  meaning: "involvement" | "authorship";
}

/**
 * A watermark detector. Async because detection belongs to whoever holds the
 * key — for Claude that is Anthropic, over an API, and there is no offline
 * check available to us or to anyone else.
 */
export interface WatermarkDetector {
  id: string;
  vendor: string;
  /**
   * Below this many characters the vendor's own guidance is that detection is
   * unreliable, so we do not spend a call or, worse, trust a coin flip.
   */
  minChars: number;
  detect(text: string): Promise<WatermarkFinding | null>;
}

/**
 * No detector ships here.
 *
 * Anthropic's detection API was announced as forthcoming and its shape is not
 * published yet. Writing a speculative client against a guessed endpoint would
 * be worse than having none — it would look implemented while failing closed in
 * a way nobody noticed. `createHttpWatermarkDetector` is the seam to fill in.
 */
export const watermarkDetectors: WatermarkDetector[] = [];

export interface HttpDetectorConfig {
  id?: string;
  vendor?: string;
  url: string;
  apiKey?: string;
  minChars?: number;
  /** Injected for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Generic HTTP detector, shaped for "POST the text, get back a probability".
 *
 * Deliberately configuration-driven rather than hard-coded to a vendor: when
 * Anthropic publishes the endpoint, this becomes one environment variable
 * rather than a code change. Any non-OK response yields `null` — unknown, not
 * absent — because a detector being down must never read as "no watermark".
 */
export function createHttpWatermarkDetector(cfg: HttpDetectorConfig): WatermarkDetector {
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  return {
    id: cfg.id ?? "http-watermark",
    vendor: cfg.vendor ?? "anthropic",
    minChars: cfg.minChars ?? 400,
    async detect(text) {
      try {
        const res = await fetchImpl(cfg.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}),
          },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
          watermarked?: boolean;
          present?: boolean;
          confidence?: number;
          probability?: number;
        };
        const present = body.watermarked ?? body.present;
        if (typeof present !== "boolean") return null;
        return {
          vendor: cfg.vendor ?? "anthropic",
          present,
          confidence: body.confidence ?? body.probability ?? (present ? 0.9 : 0),
          // Every deployed scheme today attests processing, not authorship.
          meaning: "involvement",
        };
      } catch {
        return null;
      }
    },
  };
}

/** Run the first applicable detector. Null means "we do not know". */
export async function checkWatermark(
  text: string,
  detectors: WatermarkDetector[] = watermarkDetectors,
): Promise<WatermarkFinding | null> {
  for (const d of detectors) {
    if (text.length < d.minChars) continue;
    const found = await d.detect(text);
    if (found) return found;
  }
  return null;
}

// ─── Tier 1 + 3: what can be decided locally ────────────────────────────────

export interface DetectOptions {
  /** Boilerplate score at or above which tier 3 says "agent-likely". */
  slopThreshold?: number;
}

export const DEFAULT_SLOP_THRESHOLD = 55;

export function detectOrigin(raw: string, opts: DetectOptions = {}): OriginDetection {
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
      watermark: null,
      reasons,
    };
  }

  // ── Tier 3: style. A guess, and labelled as one. (Tier 2 is a network call
  //    and is folded in afterwards by `applyWatermark`.)
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
      watermark: null,
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
    watermark: null,
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

/**
 * Fold a watermark result in.
 *
 * A TTMC signature outranks it and is left alone: the signature speaks to
 * authorship, the watermark only to involvement, and the stronger claim wins.
 * A watermark does upgrade an `unknown` or `agent-likely` message, because
 * knowing a model touched it is worth more than a style guess — but only as far
 * as `machine-involved`, never to authorship.
 */
export function applyWatermark(
  detection: OriginDetection,
  finding: WatermarkFinding | null,
): OriginDetection {
  if (!finding || !finding.present) return detection;

  const next: OriginDetection = {
    ...detection,
    watermark: finding,
    reasons: [
      ...detection.reasons,
      `${finding.vendor} watermark detected`,
      finding.meaning === "involvement"
        ? "which proves the model was involved, not that it wrote this — someone who used it to edit their own writing carries the same mark"
        : "which the vendor states attests authorship",
    ],
  };

  if (detection.verdict === "agent-verified" || detection.verdict === "human-verified") {
    // A checked signature is a stronger and more specific claim. In the human
    // case it is also a direct contradiction worth keeping visible rather than
    // overwriting: a person wrote it, and used a model somewhere along the way.
    return next;
  }

  return {
    ...next,
    verdict: finding.meaning === "authorship" ? "agent-verified" : "machine-involved",
    confidence: Math.max(detection.confidence, finding.confidence),
    source: "vendor-watermark",
  };
}

// ─── Auto-routing ───────────────────────────────────────────────────────────

export interface AutoRoutePolicy {
  enabled: boolean;
  /**
   * The weakest verdict allowed to trigger an automatic reply.
   * Defaults to `agent-verified`: only act on proof of authorship.
   */
  minVerdict: "agent-verified" | "agent-claimed" | "machine-involved" | "agent-likely";
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

/**
 * Ranked by strength of the AUTHORSHIP claim, which is the question
 * auto-answering actually turns on.
 *
 * `machine-involved` sits above a style guess and below an unverified
 * signature: it is certain about the wrong thing. A watermark tells you a model
 * touched the text; only a signature tells you a model wrote it.
 */
const VERDICT_RANK: Record<OriginVerdict, number> = {
  forged: -1,
  unknown: 0,
  "human-verified": 0,
  "agent-likely": 1,
  "machine-involved": 2,
  "agent-claimed": 3,
  "agent-verified": 4,
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
      reason:
        detection.verdict === "machine-involved"
          ? "A watermark says a model was involved, but not that it wrote this — it could be their own words, edited. Your call."
          : `Detected as ${detection.verdict}, and your policy needs ${policy.minVerdict} before answering automatically.`,
    };
  }

  return {
    action: "auto-answer",
    reason: `${detection.verdict} via ${detection.source} — answering, with disclosure.`,
  };
}
