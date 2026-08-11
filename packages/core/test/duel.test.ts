import { describe, expect, it } from "vitest";
import {
  appendTurn,
  buildTurnBrief,
  canPost,
  claimSeat,
  closeDuel,
  createDuel,
  hasConverged,
  noveltySeries,
  resolveEscalation,
  turnsRemaining,
  withEscalation,
} from "../src/duel.js";
import { createPersona } from "../src/persona.js";
import { newEscalationId, nowIso } from "../src/ids.js";
import type { Duel, Escalation, SeatId } from "../src/types.js";

function makeDuel(maxTurns = 6): Duel {
  return createDuel({
    createdBy: "user_1",
    subject: "Migration timing",
    initiator: {
      userId: "user_1",
      handle: "danilo",
      displayName: "Danilo",
      mode: "mcp",
      model: "claude-opus-5",
    },
    counterpartName: "Raj",
    maxTurns,
  });
}

function post(duel: Duel, seat: SeatId, content: string) {
  return appendTurn(duel, { seat, author: "agent", content });
}

const openEscalation = (duelId: string): Escalation => ({
  id: newEscalationId(),
  duelId,
  seat: "A",
  trigger: "money_over_authority",
  reason: "Commits $50,000, above the ceiling of $0.",
  evidence: ["$50,000"],
  raisedAt: nowIso(),
  resolvedAt: null,
});

describe("createDuel", () => {
  it("seats the initiator at A and gives the first move to B", () => {
    const d = makeDuel();
    expect(d.seats.A.userId).toBe("user_1");
    expect(d.seats.B.userId).toBeNull();
    // The premise of the product: they sent you something first.
    expect(d.turnOf).toBe("B");
    expect(d.status).toBe("live");
  });

  it("clamps an absurd turn cap", () => {
    expect(makeDuel(500).maxTurns).toBe(20);
    expect(makeDuel(0).maxTurns).toBe(2);
  });

  it("falls back to a subject rather than storing an empty one", () => {
    const d = createDuel({
      createdBy: "u",
      subject: "   ",
      initiator: { userId: "u", handle: null, displayName: "X", mode: "paste" },
    });
    expect(d.subject).toBe("Untitled exchange");
  });
});

describe("turn ordering", () => {
  it("refuses a turn from the seat whose turn it is not", () => {
    const d = makeDuel();
    expect(canPost(d, "A").ok).toBe(false);
    expect(() => post(d, "A", "jumping the queue")).toThrow(/seat B/i);
  });

  it("alternates seats", () => {
    let d = makeDuel();
    d = post(d, "B", "when can you do the migration?").duel;
    expect(d.turnOf).toBe("A");
    d = post(d, "A", "monday. friday is the board demo.").duel;
    expect(d.turnOf).toBe("B");
  });

  it("numbers turns gaplessly from 1", () => {
    let d = makeDuel();
    const first = post(d, "B", "one");
    d = first.duel;
    const second = post(d, "A", "two");
    expect(first.turn.index).toBe(1);
    expect(second.turn.index).toBe(2);
  });

  it("rejects an empty turn", () => {
    const d = makeDuel();
    expect(() => post(d, "B", "   ")).toThrow(/empty/i);
  });

  it("allows a forced turn to seed the inbound message", () => {
    const d = makeDuel();
    const r = appendTurn(d, {
      seat: "A",
      author: "human",
      content: "seeded out of order",
      force: true,
    });
    expect(r.turn.index).toBe(1);
  });
});

describe("termination", () => {
  it("stops at the turn cap", () => {
    let d = makeDuel(2);
    d = post(d, "B", "first message with some actual content in it").duel;
    const r = post(d, "A", "second message, entirely different subject matter");
    expect(r.terminated).toBe("turn_cap");
    expect(r.duel.status).toBe("converged");
    expect(r.duel.turnOf).toBeNull();
    expect(turnsRemaining(r.duel)).toBe(0);
  });

  it("refuses further turns once terminated", () => {
    let d = makeDuel(2);
    d = post(d, "B", "alpha bravo charlie delta echo foxtrot").duel;
    d = post(d, "A", "golf hotel india juliet kilo lima").duel;
    expect(canPost(d, "B").ok).toBe(false);
  });

  it("closes on demand", () => {
    const d = closeDuel(makeDuel());
    expect(d.status).toBe("closed");
    expect(d.termination).toBe("closed_by_owner");
  });
});

describe("convergence", () => {
  it("does not fire before both sides have spoken twice", () => {
    let d = makeDuel(10);
    d = post(d, "B", "the same words repeated over and over again").duel;
    d = post(d, "A", "the same words repeated over and over again").duel;
    expect(hasConverged(d)).toBe(false);
  });

  it("fires when turns stop introducing new material", () => {
    let d = makeDuel(10);
    d = post(d, "B", "can we move the database migration to friday afternoon").duel;
    d = post(d, "A", "monday is better because the board demo runs friday at two").duel;
    d = post(d, "B", "can we move the database migration to friday afternoon").duel;
    const r = post(d, "A", "monday is better because the board demo runs friday at two");
    expect(r.terminated).toBe("converged");
    expect(r.duel.status).toBe("converged");
  });

  it("keeps running while turns still add information", () => {
    let d = makeDuel(10);
    d = post(d, "B", "can we move the database migration to friday afternoon").duel;
    d = post(d, "A", "monday is better because the board demo runs friday at two").duel;
    d = post(d, "B", "raj needs the numbers before the quarterly review though").duel;
    const r = post(d, "A", "then pull a snapshot wednesday and migrate after the demo");
    expect(r.terminated).toBeNull();
    expect(r.duel.status).toBe("live");
  });

  it("reports full novelty for the opening turn", () => {
    let d = makeDuel();
    d = post(d, "B", "opening statement here").duel;
    expect(noveltySeries(d)[0]).toBe(1);
  });
});

describe("escalation", () => {
  it("halts the exchange and clears the active turn", () => {
    const d = withEscalation(makeDuel(), openEscalation("x"));
    expect(d.status).toBe("escalated");
    expect(d.turnOf).toBeNull();
    expect(canPost(d, "B").ok).toBe(false);
  });

  it("resumes the blocked seat once resolved", () => {
    const esc = openEscalation("x");
    const d = resolveEscalation(withEscalation(makeDuel(), esc), esc.id, "A");
    expect(d.status).toBe("live");
    expect(d.turnOf).toBe("A");
    expect(d.escalations[0]!.resolvedAt).not.toBeNull();
  });

  it("stays halted while any escalation is unresolved", () => {
    const first = openEscalation("x");
    let d = withEscalation(makeDuel(), first);
    d = withEscalation(d, openEscalation("x"));
    d = resolveEscalation(d, first.id, "A");
    expect(d.status).toBe("escalated");
  });
});

describe("claimSeat", () => {
  it("fills an open seat", () => {
    const d = claimSeat(makeDuel(), "B", {
      userId: "user_2",
      handle: "raj",
      displayName: "Raj",
      mode: "mcp",
    });
    expect(d.seats.B.userId).toBe("user_2");
    expect(d.seats.B.joinedAt).not.toBeNull();
  });

  it("refuses to steal a claimed seat", () => {
    const d = makeDuel();
    expect(() =>
      claimSeat(d, "A", { userId: "intruder", handle: null, displayName: "?", mode: "mcp" }),
    ).toThrow(/already claimed/i);
  });
});

describe("buildTurnBrief", () => {
  it("hands the agent the transcript, its persona, and its remaining budget", () => {
    const persona = createPersona({
      handle: "danilo",
      displayName: "Danilo",
      positions: ["Postgres is already decided; do not reopen it."],
    });
    let d = makeDuel(6);
    d = post(d, "B", "should we reconsider using mysql for this service?").duel;

    const brief = buildTurnBrief(d, "A", persona);
    expect(brief.yourSeat).toBe("A");
    expect(brief.opponent.displayName).toBe("Raj");
    expect(brief.transcript).toHaveLength(1);
    expect(brief.turnsRemaining).toBe(5);
    expect(brief.personaBrief).toContain("Postgres is already decided");
    expect(brief.policyBrief).toContain("SHORTER");
  });
});
