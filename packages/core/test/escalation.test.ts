import { describe, expect, it } from "vitest";
import { evaluateEscalation, extractAmounts, isBlocking, mustEscalate } from "../src/escalation.js";
import { createPersona } from "../src/persona.js";
import type { EscalationTrigger } from "../src/types.js";

const strict = createPersona({
  handle: "danilo",
  displayName: "Danilo",
  positions: ["Postgres is decided."],
  boundaries: ["Never agree to weekend work."],
});

const permissive = createPersona({
  handle: "danilo",
  displayName: "Danilo",
  positions: ["Postgres is decided."],
  authority: {
    canCommitTime: true,
    canCommitMoneyUsd: 25_000,
    canCommitScope: true,
    canSpeakExternally: true,
  },
});

const triggers = (text: string, persona = strict, ctx = {}) =>
  evaluateEscalation(text, persona, ctx).map((h) => h.trigger);

describe("extractAmounts", () => {
  it("normalises shorthand and separators", () => {
    expect(extractAmounts("$50k")[0]!.usd).toBe(50_000);
    expect(extractAmounts("$1.5M")[0]!.usd).toBe(1_500_000);
    expect(extractAmounts("$12,500.00")[0]!.usd).toBe(12_500);
    expect(extractAmounts("40000 USD")[0]!.usd).toBe(40_000);
  });

  it("ignores text with no amounts", () => {
    expect(extractAmounts("no money here")).toEqual([]);
  });
});

describe("money", () => {
  it("escalates a commitment above the ceiling", () => {
    expect(triggers("Sure, we'll do it for $50k.", permissive)).toContain(
      "money_over_authority" satisfies EscalationTrigger,
    );
  });

  it("allows a commitment inside the ceiling", () => {
    expect(triggers("Yes, we can do $10,000.", permissive)).not.toContain(
      "money_over_authority",
    );
  });

  it("treats a zero ceiling as never discuss money", () => {
    expect(triggers("We'll approve the $200 invoice.")).toContain("money_over_authority");
  });

  it("does not fire on a bare amount with no commitment", () => {
    expect(triggers("Their quote came in at $80,000.", permissive)).not.toContain(
      "money_over_authority",
    );
  });
});

describe("time and scope", () => {
  it("escalates a calendar commitment when time is not delegated", () => {
    expect(triggers("Let's meet Thursday at 3pm.")).toContain("time_commitment");
  });

  it("permits it when time is delegated", () => {
    expect(triggers("Let's meet Thursday at 3pm.", permissive)).not.toContain(
      "time_commitment",
    );
  });

  it("escalates taking on new work", () => {
    expect(triggers("Sure, we'll build the export endpoint for you.")).toContain(
      "scope_commitment",
    );
  });

  // Regression: a bare clock time used to escalate on its own, which fired on
  // essentially every scheduling message and trained users to click through.
  it("ignores a clock time that commits nothing", () => {
    expect(
      triggers(
        "Friday does not work. The board demo runs Friday at 2pm and nobody is around to roll back.",
      ),
    ).not.toContain("time_commitment");
  });

  it("still escalates a clock time that is being agreed to", () => {
    expect(triggers("Works for me, let's do 2pm.")).toContain("time_commitment");
  });

  it("ignores a deadline mentioned as context rather than accepted", () => {
    expect(triggers("Their deadline is end of quarter, which is why I said no.")).not.toContain(
      "time_commitment",
    );
  });
});

describe("hard fences", () => {
  it("blocks a live credential outright", () => {
    const hits = evaluateEscalation(
      "here you go: sk-ant-api03-abcdefghijklmnop1234567890",
      permissive,
    );
    const secret = hits.find((h) => h.trigger === "credentials_or_secrets");
    expect(secret).toBeDefined();
    expect(isBlocking(secret!)).toBe(true);
    // Never leak the matched secret back through the evidence field.
    expect(secret!.evidence.join(" ")).not.toContain("sk-ant");
  });

  it("catches a database URL with an inline password", () => {
    expect(triggers("postgres://admin:hunter2@db.internal:5432/prod", permissive)).toContain(
      "credentials_or_secrets",
    );
  });

  // Regression: substring matching made "nda" fire inside "Monday", so
  // declining a meeting escalated as contractual language.
  it("does not find legal terms hiding inside ordinary words", () => {
    const clean = triggers(
      "Monday morning works. Three of us are around, and translating the schema takes an hour.",
      permissive,
    );
    expect(clean).not.toContain("legal_or_contractual");
    expect(clean).not.toContain("interpersonal_conflict");
  });

  it("escalates contractual language regardless of authority", () => {
    expect(triggers("We're fine with the indemnification clause in the MSA.", permissive)).toContain(
      "legal_or_contractual",
    );
  });

  it("escalates interpersonal conflict regardless of authority", () => {
    expect(
      triggers("Honestly I'm frustrated, this is the third time we've slipped.", permissive),
    ).toContain("interpersonal_conflict");
  });
});

describe("persona boundaries", () => {
  it("fires on a stated boundary", () => {
    expect(triggers("We could agree to some weekend work if it helps.")).toContain(
      "persona_boundary",
    );
  });

  // Regression: a `length > 2` token filter dropped "Q3", so a fence naming a
  // short code could never match anything.
  it("fires on a boundary built around a short code", () => {
    const fenced = createPersona({
      handle: "danilo",
      displayName: "Danilo",
      positions: ["Postgres is decided."],
      escalateOn: ["Anything about the Q3 reorg"],
    });
    expect(
      triggers("The Q3 reorg lands next month, so I need your roadmap.", fenced),
    ).toContain("persona_boundary");
  });

  it("does not fire on unrelated text", () => {
    expect(triggers("The staging database is on Postgres 14.")).not.toContain(
      "persona_boundary",
    );
  });
});

describe("context signals", () => {
  it("escalates low confidence", () => {
    expect(triggers("Probably fine.", permissive, { confidence: 0.2 })).toContain(
      "low_confidence",
    );
  });

  it("honours an explicit hand-off request", () => {
    expect(triggers("Fine.", permissive, { requestedByAgent: true })).toContain(
      "explicit_request",
    );
  });

  it("escalates an external counterpart for an explicitly internal-only agent", () => {
    const internalOnly = createPersona({
      handle: "danilo",
      displayName: "Danilo",
      positions: ["Postgres is decided."],
      authority: { canSpeakExternally: false },
    });
    expect(triggers("Hello.", internalOnly, { counterpartIsExternal: true })).toContain(
      "external_party",
    );
  });

  it("lets a default agent answer someone outside the org", () => {
    // Replying to whoever messaged you is the product. Only what the agent may
    // agree to is locked down by default, not whether it may speak.
    expect(triggers("Monday works better.", strict, { counterpartIsExternal: true })).not.toContain(
      "external_party",
    );
  });
});

describe("clean turns", () => {
  it("passes ordinary content through untouched", () => {
    const hits = evaluateEscalation(
      "Staging is on Postgres 14, so the extension is missing. Raj owns that dashboard.",
      permissive,
    );
    expect(mustEscalate(hits)).toBe(false);
  });

  it("reports every reason, not just the first", () => {
    const hits = evaluateEscalation(
      "Let's meet Friday at 2pm and we'll approve the $90k contract.",
      strict,
    );
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});
