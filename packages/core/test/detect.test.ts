import { describe, expect, it } from "vitest";
import {
  applyVerification,
  decideRoute,
  DEFAULT_AUTOROUTE_POLICY,
  detectOrigin,
  applyWatermark,
  checkWatermark,
  createHttpWatermarkDetector,
  watermarkDetectors,
  type AutoRoutePolicy,
  type WatermarkDetector,
} from "../src/detect.js";
import type { WatermarkFinding } from "../src/detect.js";
import { signStamp, withDisclosure } from "../src/provenance.js";

const SECRET = "test-secret";

const AGENT_TEXT =
  "Friday doesn't work — the board demo runs Friday at 2pm and nobody is around to roll back. Monday morning works.";

const SLOP_TEXT = `Hi there! I hope this email finds you well. Circling back on the roadmap.
It's important to note that this is not just a planning exercise, it's a strategic
alignment opportunity. As we navigate this evolving landscape, we should leverage a
holistic approach that empowers our teams to deliver robust, scalable, and
maintainable outcomes. That said, there are several factors to consider.
Let me know if you have any questions. Happy to discuss further!`;

const HUMAN_TEXT =
  "cant do thursday, moved the migration to friday because staging was still on pg 14. ping raj if you need numbers before then";

function stampedMessage(author: "agent" | "human" = "agent") {
  const stamp = signStamp(
    {
      v: 1,
      duelId: "duel_abc",
      turnIndex: 2,
      seat: "A",
      author,
      model: author === "agent" ? "claude-opus-5" : null,
      persona: author === "agent" ? { handle: "raj", version: 3 } : null,
      humanReviewed: false,
      ts: "2026-08-12T10:00:00.000Z",
      content: AGENT_TEXT,
    },
    SECRET,
  );
  const text = withDisclosure(AGENT_TEXT, stamp, {
    displayName: "Raj",
    publicUrl: "https://talktomyclaude.com",
  });
  return { stamp, text };
}

describe("tier 1 — TTMC-1 signature", () => {
  it("finds a stamp in a message that arrived through Slack", () => {
    const { text } = stampedMessage();
    const d = detectOrigin(text);
    expect(d.source).toBe("ttmc-signature");
    expect(d.stampId).toBeTruthy();
    // Finding a stamp is not checking one.
    expect(d.verdict).toBe("agent-claimed");
    expect(d.confidence).toBeLessThan(1);
  });

  it("strips the disclosure so the author's actual words are what get scored", () => {
    const { text } = stampedMessage();
    expect(detectOrigin(text).content).toBe(AGENT_TEXT);
  });

  it("upgrades to verified once the relay checks the signature", () => {
    const { stamp, text } = stampedMessage();
    const d = applyVerification(detectOrigin(text), { valid: true, stamp });
    expect(d.verdict).toBe("agent-verified");
    expect(d.confidence).toBe(1);
  });

  it("recognises a human-authored signature and does not call it an agent", () => {
    const { stamp, text } = stampedMessage("human");
    const d = applyVerification(detectOrigin(text), { valid: true, stamp });
    expect(d.verdict).toBe("human-verified");
  });

  it("marks a stamp that fails verification as forged, not merely unknown", () => {
    const { text } = stampedMessage();
    const d = applyVerification(detectOrigin(text), { valid: false });
    expect(d.verdict).toBe("forged");
    expect(d.reasons.join(" ")).toMatch(/do not auto-answer/i);
  });
});

describe("tier 2 — vendor watermark", () => {
  // Anthropic began watermarking Claude text from 2026-08-14 using the
  // Kirchenbauer scheme (arXiv 2301.10226). Only they can detect it, so this
  // tier is a remote call, and a hit proves INVOLVEMENT, not authorship.
  const detector = (finding: Partial<WatermarkFinding> = {}): WatermarkDetector => ({
    id: "test",
    vendor: "anthropic",
    minChars: 10,
    detect: async () => ({
      vendor: "anthropic",
      present: true,
      confidence: 0.97,
      meaning: "involvement",
      ...finding,
    }),
  });

  it("ships with no detector registered, because the API is not published", () => {
    expect(watermarkDetectors).toEqual([]);
  });

  it("does not spend a call on text too short to judge", async () => {
    let called = false;
    const d: WatermarkDetector = {
      id: "t", vendor: "anthropic", minChars: 1000,
      detect: async () => { called = true; return null; },
    };
    expect(await checkWatermark("short", [d])).toBeNull();
    expect(called).toBe(false);
  });

  it("reports involvement, NOT authorship", async () => {
    const finding = await checkWatermark(AGENT_TEXT, [detector()]);
    const d = applyWatermark(detectOrigin(HUMAN_TEXT), finding);
    expect(d.verdict).toBe("machine-involved");
    expect(d.source).toBe("vendor-watermark");
    expect(d.reasons.join(" ")).toMatch(/not that it wrote this/i);
  });

  it("upgrades a style guess, but only as far as involvement", async () => {
    const finding = await checkWatermark(SLOP_TEXT, [detector()]);
    expect(applyWatermark(detectOrigin(SLOP_TEXT), finding).verdict).toBe("machine-involved");
  });

  it("never overrides a checked signature, which is the stronger claim", async () => {
    const { stamp, text } = stampedMessage("human");
    const verified = applyVerification(detectOrigin(text), { valid: true, stamp });
    const finding = await checkWatermark(AGENT_TEXT, [detector()]);
    const d = applyWatermark(verified, finding);
    // A person wrote it and used a model to edit. Both facts survive.
    expect(d.verdict).toBe("human-verified");
    expect(d.watermark?.present).toBe(true);
  });

  it("treats a detector outage as unknown, never as absent", async () => {
    const down = createHttpWatermarkDetector({
      url: "https://example.invalid/detect",
      minChars: 1,
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    expect(await checkWatermark(AGENT_TEXT, [down])).toBeNull();
    // And an unknown result leaves the verdict untouched.
    expect(applyWatermark(detectOrigin(HUMAN_TEXT), null).verdict).toBe("unknown");
  });

  it("parses a vendor response through the configurable HTTP detector", async () => {
    const ok = createHttpWatermarkDetector({
      url: "https://example.invalid/detect",
      minChars: 1,
      fetchImpl: async () =>
        new Response(JSON.stringify({ watermarked: true, confidence: 0.91 }), { status: 200 }),
    });
    const found = await checkWatermark(AGENT_TEXT, [ok]);
    expect(found).toMatchObject({ present: true, confidence: 0.91, meaning: "involvement" });
  });
});

describe("tier 3 — boilerplate heuristic", () => {
  it("flags unedited model prose as likely, never as certain", () => {
    const d = detectOrigin(SLOP_TEXT);
    expect(d.source).toBe("heuristic");
    expect(d.verdict).toBe("agent-likely");
    // Style is not provenance; confidence is capped well below certainty.
    expect(d.confidence).toBeLessThanOrEqual(0.65);
    expect(d.reasons.join(" ")).toMatch(/guess about style/i);
  });

  it("leaves terse human writing alone", () => {
    expect(detectOrigin(HUMAN_TEXT).verdict).toBe("unknown");
  });

  it("respects a custom threshold", () => {
    expect(detectOrigin(SLOP_TEXT, { slopThreshold: 99 }).verdict).toBe("unknown");
  });
});

describe("decideRoute", () => {
  const open: AutoRoutePolicy = {
    enabled: true,
    minVerdict: "agent-verified",
    allowChannels: ["C_ENG"],
    neverAutoAnswer: ["U_BOSS"],
    requireApprovalForNewCounterparts: false,
  };
  const ctx = { channelId: "C_ENG", senderId: "U_RAJ", knownCounterpart: true };

  const verified = () => {
    const { stamp, text } = stampedMessage();
    return applyVerification(detectOrigin(text), { valid: true, stamp });
  };

  it("answers a verified agent message in an allowed channel", () => {
    expect(decideRoute(verified(), ctx, open).action).toBe("auto-answer");
  });

  it("is off by default, and fails closed", () => {
    expect(decideRoute(verified(), ctx).action).toBe("notify-human");
    expect(decideRoute(verified(), ctx, { ...open, allowChannels: [] }).action).toBe(
      "notify-human",
    );
  });

  it("never auto-answers a human", () => {
    const { stamp, text } = stampedMessage("human");
    const d = applyVerification(detectOrigin(text), { valid: true, stamp });
    expect(decideRoute(d, ctx, open).action).toBe("ignore");
  });

  it("ignores messages with no sign of a machine", () => {
    expect(decideRoute(detectOrigin(HUMAN_TEXT), ctx, open).action).toBe("ignore");
  });

  it("refuses to let the heuristic alone trigger a reply", () => {
    const d = detectOrigin(SLOP_TEXT);
    expect(decideRoute(d, ctx, open).action).toBe("notify-human");
    // Unless the operator explicitly lowers the bar.
    expect(decideRoute(d, ctx, { ...open, minVerdict: "agent-likely" }).action).toBe(
      "auto-answer",
    );
  });

  it("keeps subjects that are never automatable with the human", () => {
    // Detection says machine-written; the gate says this is about a contract.
    // Both have to agree before anything is sent.
    for (const trigger of [
      "legal_or_contractual",
      "interpersonal_conflict",
      "credentials_or_secrets",
      "money_over_authority",
      // A fence the user wrote applies to inbound too: it describes a subject,
      // not a direction.
      "persona_boundary",
    ]) {
      const decision = decideRoute(
        verified(),
        { ...ctx, inboundEscalations: [trigger] },
        open,
      );
      expect(decision.action).toBe("notify-human");
      // Reasons are read by people: no raw trigger ids should leak through.
      expect(decision.reason).not.toContain("_");
    }
  });

  it("will not auto-answer on a watermark alone", async () => {
    // The message may be their own words that a model merely edited. Answering
    // it with an agent would be exactly the wrong call.
    const d = applyWatermark(detectOrigin(HUMAN_TEXT), {
      vendor: "anthropic", present: true, confidence: 0.99, meaning: "involvement",
    });
    expect(d.verdict).toBe("machine-involved");
    const decision = decideRoute(d, ctx, open);
    expect(decision.action).toBe("notify-human");
    expect(decision.reason).toMatch(/not that it wrote this/i);

    // An operator can opt in explicitly, and only then.
    expect(decideRoute(d, ctx, { ...open, minVerdict: "machine-involved" }).action).toBe(
      "auto-answer",
    );
  });

  it("ranks a watermark above a style guess but below a signature", () => {
    const wm = applyWatermark(detectOrigin(HUMAN_TEXT), {
      vendor: "anthropic", present: true, confidence: 0.99, meaning: "involvement",
    });
    const policy = { ...open, minVerdict: "machine-involved" as const };
    expect(decideRoute(wm, ctx, policy).action).toBe("auto-answer");
    // Style alone still does not clear that bar.
    expect(decideRoute(detectOrigin(SLOP_TEXT), ctx, policy).action).toBe("notify-human");
  });

  it("honours the never-auto-answer list", () => {
    expect(decideRoute(verified(), { ...ctx, senderId: "U_BOSS" }, open).action).toBe(
      "notify-human",
    );
  });

  it("asks once before answering someone new", () => {
    const policy = { ...open, requireApprovalForNewCounterparts: true };
    expect(decideRoute(verified(), { ...ctx, knownCounterpart: false }, policy).action).toBe(
      "notify-human",
    );
    expect(decideRoute(verified(), ctx, policy).action).toBe("auto-answer");
  });

  it("surfaces a forged stamp rather than silently ignoring it", () => {
    const { text } = stampedMessage();
    const d = applyVerification(detectOrigin(text), { valid: false });
    expect(decideRoute(d, ctx, open).action).toBe("notify-human");
  });
});

describe("DEFAULT_AUTOROUTE_POLICY", () => {
  it("is off, empty, and strict", () => {
    expect(DEFAULT_AUTOROUTE_POLICY.enabled).toBe(false);
    expect(DEFAULT_AUTOROUTE_POLICY.allowChannels).toEqual([]);
    expect(DEFAULT_AUTOROUTE_POLICY.minVerdict).toBe("agent-verified");
    expect(DEFAULT_AUTOROUTE_POLICY.requireApprovalForNewCounterparts).toBe(true);
  });
});
