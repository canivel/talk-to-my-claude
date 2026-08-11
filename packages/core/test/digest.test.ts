import { describe, expect, it } from "vitest";
import { buildDigest, fallbackDigest, renderDigestMarkdown } from "../src/digest.js";
import { appendTurn, createDuel, withEscalation } from "../src/duel.js";
import { newEscalationId, nowIso } from "../src/ids.js";
import { scoreSlop } from "../src/slop.js";
import type { Duel } from "../src/types.js";

function duelWithTurns(): Duel {
  let d = createDuel({
    createdBy: "u1",
    subject: "Migration timing",
    initiator: { userId: "u1", handle: "danilo", displayName: "Danilo", mode: "mcp" },
    counterpartName: "Raj",
    maxTurns: 4,
  });
  d = appendTurn(d, {
    seat: "B",
    author: "agent",
    content:
      "I hope this finds you well. Circling back on the migration window, it is important to note that several stakeholders have raised concerns about the proposed timeline and we should align on a cadence.",
    slop: scoreSlop(
      "I hope this finds you well. Circling back on the migration window, it is important to note that several stakeholders have raised concerns about the proposed timeline and we should align on a cadence.",
    ),
  }).duel;
  d = appendTurn(d, {
    seat: "A",
    author: "agent",
    content: "Monday, not Friday. The board demo runs Friday at 2pm and nobody is around to roll back.",
  }).duel;
  return d;
}

describe("buildDigest", () => {
  it("computes compression from the real transcript, not from the agent", () => {
    const d = duelWithTurns();
    const { digest } = buildDigest(
      d,
      {
        headline: "Migration moves to Monday.",
        decisions: [{ text: "Migration runs Monday.", sourceTurns: [2] }],
      },
      "A",
    );
    expect(digest.stats.turnCount).toBe(2);
    expect(digest.stats.inboundWords).toBe(
      d.turns.reduce((n, t) => n + t.wordCount, 0),
    );
    expect(digest.stats.compressionRatio).toBeGreaterThan(1);
    expect(digest.stats.meanSlop).not.toBeNull();
  });

  it("drops citations to turns that do not exist", () => {
    const { digest } = buildDigest(
      duelWithTurns(),
      { headline: "x", decisions: [{ text: "Invented citation.", sourceTurns: [99, 2] }] },
      "A",
    );
    expect(digest.decisions[0]!.sourceTurns).toEqual([2]);
  });

  it("refuses a due date the agent made up", () => {
    const { digest, problems } = buildDigest(
      duelWithTurns(),
      {
        headline: "x",
        actionItems: [{ text: "Ship it.", owner: "A", due: "next Tuesday" }],
      },
      "A",
    );
    expect(digest.actionItems[0]!.due).toBeNull();
    expect(problems.some((p) => p.field === "actionItems.due")).toBe(true);
  });

  it("forces unresolved escalations into needsHuman", () => {
    const d = withEscalation(duelWithTurns(), {
      id: newEscalationId(),
      duelId: "x",
      seat: "A",
      trigger: "legal_or_contractual",
      reason: "This turn touches contractual language.",
      evidence: ["msa"],
      raisedAt: nowIso(),
      resolvedAt: null,
    });
    // The agent claims everything is settled. It does not get the last word.
    const { digest } = buildDigest(d, { headline: "All good!", needsHuman: [] }, "A");
    expect(digest.needsHuman).toContain("This turn touches contractual language.");
  });

  it("flags a headline that outgrew its purpose", () => {
    const { problems } = buildDigest(
      duelWithTurns(),
      { headline: "word ".repeat(60) },
      "A",
    );
    expect(problems.some((p) => p.field === "headline")).toBe(true);
  });

  it("substitutes a headline when the agent returns none", () => {
    const { digest, problems } = buildDigest(duelWithTurns(), { headline: "" }, "A");
    expect(digest.headline).toContain("Migration timing");
    expect(problems.some((p) => p.field === "headline")).toBe(true);
  });

  it("caps runaway item lists", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `item ${i}` }));
    const { digest } = buildDigest(duelWithTurns(), { headline: "x", decisions: many }, "A");
    expect(digest.decisions).toHaveLength(10);
  });
});

describe("fallbackDigest", () => {
  it("states only what is verifiable rather than inventing a summary", () => {
    const digest = fallbackDigest(duelWithTurns());
    expect(digest.generatedBySeat).toBeNull();
    expect(digest.decisions).toEqual([]);
    expect(digest.headline).toMatch(/read the transcript/i);
  });
});

describe("renderDigestMarkdown", () => {
  it("leads with what needs a human and ends with the compression stat", () => {
    const d = duelWithTurns();
    const { digest } = buildDigest(
      d,
      {
        headline: "Migration moves to Monday.",
        decisions: [{ text: "Migration runs Monday.", sourceTurns: [2] }],
        actionItems: [{ text: "Tell Raj.", owner: "A", due: "2026-08-14" }],
        needsHuman: ["Confirm the board demo slot."],
      },
      "A",
    );
    const md = renderDigestMarkdown(digest, d);
    expect(md.indexOf("### Needs you")).toBeLessThan(md.indexOf("### Decided"));
    expect(md).toContain("**Danilo** (by 2026-08-14): Tell Raj.");
    expect(md).toContain("× compression");
    expect(md).toContain("_(turn 2)_");
  });
});
