import { describe, expect, it } from "vitest";
import { computeMetrics, turnTrend } from "../src/metrics.js";
import { appendTurn, createDuel } from "../src/duel.js";
import { buildDigest } from "../src/digest.js";
import { newEscalationId, nowIso } from "../src/ids.js";
import { scoreSlop } from "../src/slop.js";
import type { Duel } from "../src/types.js";

function makeDuel(opts: {
  turns?: number;
  createdAt?: string;
  digestWords?: number;
  needsHuman?: string[];
  escalated?: boolean;
  bothSeats?: boolean;
} = {}): Duel {
  let d = createDuel({
    createdBy: "u1",
    subject: "Subject",
    initiator: { userId: "u1", handle: "a", displayName: "A", mode: "mcp" },
    maxTurns: 20,
  });

  if (opts.createdAt) d = { ...d, createdAt: opts.createdAt };
  if (opts.bothSeats) {
    d = { ...d, seats: { ...d.seats, B: { ...d.seats.B, userId: "u2" } } };
  }

  for (let i = 0; i < (opts.turns ?? 2); i++) {
    // Distinct wording per turn so convergence does not end it early.
    const content = `Turn number ${i} discussing topic ${i} with entirely separate wording ${i}.`;
    d = appendTurn(d, {
      seat: i % 2 === 0 ? "B" : "A",
      author: i % 2 === 0 ? "unattributed" : "agent",
      content,
      // The relay scores every turn, so the fixture must too — otherwise the
      // slop metrics read as "no data" rather than exercising the split.
      slop: scoreSlop(content),
      force: true,
    }).duel;
  }

  if (opts.digestWords !== undefined) {
    const { digest } = buildDigest(
      d,
      {
        headline: Array.from({ length: opts.digestWords }, (_, i) => `w${i}`).join(" "),
        needsHuman: opts.needsHuman ?? [],
      },
      "A",
    );
    d = { ...d, digest };
  }

  if (opts.escalated) {
    d = {
      ...d,
      escalations: [
        {
          id: newEscalationId(),
          duelId: d.id,
          seat: "A",
          trigger: "money_over_authority",
          reason: "over cap",
          evidence: [],
          raisedAt: nowIso(),
          resolvedAt: null,
        },
      ],
    };
  }

  return d;
}

const criterion = (duels: Duel[], id: string) =>
  computeMetrics(duels).criteria.find((c) => c.id === id)!;

describe("computeMetrics", () => {
  it("reports unknown rather than noise on a tiny sample", () => {
    const m = computeMetrics([makeDuel()]);
    expect(m.totalExchanges).toBe(1);
    for (const id of ["escalation", "second-seat"]) {
      expect(m.criteria.find((c) => c.id === id)!.health).toBe("unknown");
    }
  });

  it("handles an empty dataset without dividing by zero", () => {
    const m = computeMetrics([]);
    expect(m.totalExchanges).toBe(0);
    expect(m.inboundMeanSlop).toBeNull();
    expect(m.criteria.every((c) => c.health === "unknown")).toBe(true);
  });

  it("scores strong compression as good", () => {
    // Long transcripts, tiny digests.
    const duels = Array.from({ length: 6 }, () => makeDuel({ turns: 8, digestWords: 4 }));
    const c = criterion(duels, "compression");
    expect(c.value).toBeGreaterThan(5);
    expect(c.health).toBe("good");
  });

  it("scores a digest that barely shrinks anything as bad", () => {
    const duels = Array.from({ length: 6 }, () => makeDuel({ turns: 2, digestWords: 40 }));
    expect(criterion(duels, "compression").health).toBe("bad");
  });

  it("treats a silent gate and a noisy gate as different failures", () => {
    const quiet = Array.from({ length: 10 }, () => makeDuel());
    expect(criterion(quiet, "escalation").health).toBe("watch");

    const noisy = Array.from({ length: 10 }, () => makeDuel({ escalated: true }));
    expect(criterion(noisy, "escalation").health).toBe("bad");

    const healthy = Array.from({ length: 10 }, (_, i) =>
      makeDuel({ escalated: i < 1 }),
    );
    expect(criterion(healthy, "escalation").health).toBe("good");
  });

  it("counts digests that needed nothing from a human", () => {
    const duels = [
      ...Array.from({ length: 5 }, () => makeDuel({ turns: 4, digestWords: 5 })),
      ...Array.from({ length: 5 }, () =>
        makeDuel({ turns: 4, digestWords: 5, needsHuman: ["confirm the budget"] }),
      ),
    ];
    const c = criterion(duels, "clean");
    expect(Math.round(c.value!)).toBe(50);
    expect(c.health).toBe("good");
  });

  it("tracks second seats claimed", () => {
    const duels = Array.from({ length: 10 }, (_, i) => makeDuel({ bothSeats: i < 3 }));
    const c = criterion(duels, "second-seat");
    expect(Math.round(c.value!)).toBe(30);
    expect(c.health).toBe("good");
  });

  it("separates inbound boilerplate from what our own agents write", () => {
    const m = computeMetrics([makeDuel({ turns: 6 })]);
    expect(m.inboundMeanSlop).not.toBeNull();
    expect(m.agentMeanSlop).not.toBeNull();
  });
});

describe("turnTrend", () => {
  it("stays null until the halves mean something", () => {
    expect(turnTrend([makeDuel(), makeDuel()])).toBeNull();
  });

  // The metric that tells us we have become the thing we complained about.
  it("flags exchanges getting longer over time", () => {
    const duels = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeDuel({ turns: 2, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeDuel({ turns: 10, createdAt: `2026-02-0${i + 1}T00:00:00.000Z` }),
      ),
    ];
    expect(turnTrend(duels)).toBe(8);
    expect(criterion(duels, "turn-trend").health).toBe("bad");
  });

  it("is happy when exchanges stay short", () => {
    const duels = Array.from({ length: 8 }, (_, i) =>
      makeDuel({ turns: 2, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }),
    );
    expect(turnTrend(duels)).toBe(0);
    expect(criterion(duels, "turn-trend").health).toBe("good");
  });
});
