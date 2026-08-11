import { describe, expect, it } from "vitest";
import {
  parseHeader,
  renderFooter,
  renderHeader,
  signStamp,
  stampId,
  stripDisclosure,
  verifyStamp,
  withDisclosure,
} from "../src/provenance.js";
import type { SignInput } from "../src/provenance.js";

const SECRET = "test-secret-key";
const OTHER_SECRET = "a-different-secret";

const base: SignInput = {
  v: 1,
  duelId: "duel_abc123",
  turnIndex: 3,
  seat: "A",
  author: "agent",
  model: "claude-opus-5",
  persona: { handle: "danilo", version: 4 },
  humanReviewed: false,
  ts: "2026-08-11T12:00:00.000Z",
  content: "Monday works. Friday does not — the board demo is at 2pm.",
};

describe("signStamp / verifyStamp", () => {
  it("round-trips", () => {
    const stamp = signStamp(base, SECRET);
    expect(verifyStamp(stamp, base.content, [SECRET])).toMatchObject({
      valid: true,
      keyGeneration: "current",
    });
  });

  it("binds to the exact content", () => {
    const stamp = signStamp(base, SECRET);
    const tampered = "Friday works. Monday does not.";
    const r = verifyStamp(stamp, tampered, [SECRET]);
    expect(r.valid).toBe(false);
    expect(r.failure).toBe("content_mismatch");
  });

  it("rejects a stamp whose claims were edited", () => {
    const stamp = signStamp(base, SECRET);
    // The attack that matters: relabelling agent output as human-written.
    const forged = { ...stamp, author: "human" as const };
    const r = verifyStamp(forged, base.content, [SECRET]);
    expect(r.valid).toBe(false);
    expect(r.failure).toBe("bad_signature");
  });

  it("rejects a stamp signed with an unknown key", () => {
    const stamp = signStamp(base, OTHER_SECRET);
    expect(verifyStamp(stamp, base.content, [SECRET]).valid).toBe(false);
  });

  it("still verifies against a rotated-out key", () => {
    const stamp = signStamp(base, OTHER_SECRET);
    expect(verifyStamp(stamp, base.content, [SECRET, OTHER_SECRET])).toMatchObject({
      valid: true,
      keyGeneration: "previous",
    });
  });

  it("survives CRLF line endings and trailing whitespace", () => {
    const multiline: SignInput = { ...base, content: "line one\nline two" };
    const stamp = signStamp(multiline, SECRET);
    expect(verifyStamp(stamp, "line one   \r\nline two\r\n", [SECRET]).valid).toBe(true);
  });

  it("refuses to sign without a secret", () => {
    expect(() => signStamp(base, "")).toThrow(/secret/i);
  });

  it("rejects an unsupported spec version", () => {
    const stamp = signStamp(base, SECRET);
    const r = verifyStamp({ ...stamp, v: 2 as unknown as 1 }, base.content, [SECRET]);
    expect(r.failure).toBe("unsupported_version");
  });
});

describe("header rendering", () => {
  it("round-trips through render and parse", () => {
    const stamp = signStamp(base, SECRET);
    const parsed = parseHeader(renderHeader(stamp));
    expect(parsed).toEqual(stamp);
    expect(verifyStamp(parsed!, base.content, [SECRET]).valid).toBe(true);
  });

  it("returns null on garbage", () => {
    expect(parseHeader("Subject: hello")).toBeNull();
  });

  it("handles a null persona and model", () => {
    const humanStamp = signStamp(
      { ...base, author: "human", model: null, persona: null },
      SECRET,
    );
    const parsed = parseHeader(renderHeader(humanStamp));
    expect(parsed!.persona).toBeNull();
    expect(parsed!.model).toBeNull();
    expect(verifyStamp(parsed!, base.content, [SECRET]).valid).toBe(true);
  });
});

describe("footers", () => {
  const opts = { displayName: "Danilo", publicUrl: "https://talktomyclaude.com/" };

  it("discloses agent authorship and links a verifier", () => {
    const stamp = signStamp(base, SECRET);
    const footer = renderFooter(stamp, opts);
    expect(footer).toContain("Danilo's Claude wrote this");
    expect(footer).toContain("not reviewed by a human");
    expect(footer).toContain(`/v/${stampId(stamp)}`);
  });

  it("says so when a human actually wrote it", () => {
    const stamp = signStamp({ ...base, author: "human" }, SECRET);
    expect(renderFooter(stamp, opts)).toContain("personally");
  });

  it("marks human review when it happened", () => {
    const stamp = signStamp({ ...base, humanReviewed: true }, SECRET);
    expect(renderFooter(stamp, opts)).toContain("reviewed by Danilo");
  });

  it("does not stack disclosures across hops", () => {
    const stamp = signStamp(base, SECRET);
    const once = withDisclosure(base.content, stamp, opts);
    const twice = withDisclosure(once, stamp, opts);
    expect(twice.match(/🤖/g)).toHaveLength(1);
  });

  it("strips a disclosure back to the original words", () => {
    const stamp = signStamp(base, SECRET);
    const stamped = withDisclosure(base.content, stamp, opts);
    expect(stripDisclosure(stamped)).toBe(base.content);
  });

  it("strips headers as well as footers", () => {
    const stamp = signStamp(base, SECRET);
    const messy = `${renderHeader(stamp)}\n\n${base.content}`;
    expect(stripDisclosure(messy)).toBe(base.content);
  });
});
