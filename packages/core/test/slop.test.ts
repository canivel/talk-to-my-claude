import { describe, expect, it } from "vitest";
import { scoreSlop, topSignals } from "../src/slop.js";

const SLOP = `I hope this email finds you well! Great question about the migration timeline.

It's important to note that this is not just a technical decision, it's a strategic
one. As we navigate this evolving landscape, we should leverage a holistic approach
that empowers the team to deliver robust, scalable, and maintainable outcomes.

- **Alignment**: We must ensure stakeholder buy-in across the organization.
- **Cadence**: A regular sync will foster transparency and unlock momentum.
- **Ownership**: Clear accountability is crucial to the success of this initiative.

That said, there are several factors to consider before we commit. Generally
speaking, the intricate nature of the ecosystem means we should proceed with care.
Ultimately, the cornerstone of any transformative effort is trust in the process.

Let me know if you have any questions. Happy to discuss further!`;

const HUMAN = `cant do thursday. moved the migration to friday because staging was
still on pg 14 and the extension didnt exist yet. if you need the numbers before
then ping raj, he owns that dashboard now.`;

describe("scoreSlop", () => {
  it("scores unedited model boilerplate as slop", () => {
    const r = scoreSlop(SLOP);
    expect(r.score).toBeGreaterThanOrEqual(65);
    expect(r.band).toBe("pure-slop");
    expect(r.compressionOpportunity).toBeGreaterThan(0.3);
  });

  it("scores terse human writing as human", () => {
    const r = scoreSlop(HUMAN);
    expect(r.score).toBeLessThan(25);
    expect(r.band).toBe("human");
  });

  it("names the signals that fired, with evidence", () => {
    const r = scoreSlop(SLOP);
    const ids = r.signals.map((s) => s.id);
    expect(ids).toContain("llm_lexicon");
    expect(ids).toContain("boilerplate_open");
    expect(ids).toContain("boilerplate_close");
    expect(ids).toContain("not_just_but");
    // Every reported signal must be able to show its work.
    for (const s of r.signals) expect(s.points).toBeGreaterThan(0);
    expect(r.signals.find((s) => s.id === "llm_lexicon")!.evidence.length).toBeGreaterThan(0);
  });

  it("ranks signals by contribution", () => {
    const points = scoreSlop(SLOP).signals.map((s) => s.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
  });

  it("refuses to judge text that is too short to judge", () => {
    const r = scoreSlop("Great question! Thanks for reaching out.");
    expect(r.score).toBeLessThan(25);
    expect(r.verdict).toMatch(/too short/i);
  });

  it("is deterministic", () => {
    expect(scoreSlop(SLOP)).toEqual(scoreSlop(SLOP));
  });

  it("handles empty input without throwing", () => {
    const r = scoreSlop("");
    expect(r.score).toBe(0);
    expect(r.wordCount).toBe(0);
    expect(r.signals).toEqual([]);
  });

  it("does not penalise a human who happens to write long", () => {
    const longHuman = `ok so the reason staging broke is dumb. we pinned pg to 14
      in the compose file back in march and nobody touched it since. the extension
      we need shipped in 15. i bumped it locally and the migration ran in 40s.
      i don't want to do this friday though, we've got the board demo at 2pm and
      if it goes sideways there's no one around. monday works better for me.
      raj disagrees, he thinks waiting costs us the whole sprint. i think he's
      wrong but it's his call, he owns the dashboard.`;
    expect(scoreSlop(longHuman).score).toBeLessThan(35);
  });
});

describe("topSignals", () => {
  it("returns at most n signals", () => {
    expect(topSignals(scoreSlop(SLOP), 2)).toHaveLength(2);
  });
});
