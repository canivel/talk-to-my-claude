/**
 * TTMC-1 disclosure stamps. Full spec: docs/protocol.md
 *
 * This is the ethical spine of the product. Everything else is convenience;
 * this is the part that makes "let the AIs talk" defensible instead of gross.
 *
 * Three properties we care about, in order:
 *
 *  1. Non-repudiable. The stamp is signed by the relay, not by the author, so
 *     a participant cannot claim a human wrote something an agent wrote. The
 *     interesting attack is not forging "an agent said this" — nobody wants to
 *     be accused of that — it is forging "a human said this". Server-side
 *     signing is what closes it.
 *
 *  2. Content-bound. The stamp carries a hash of the exact text, so a stamp
 *     cannot be lifted off a benign message and pasted onto a different one.
 *
 *  3. Independently checkable. Anyone holding the message and the stamp can
 *     hit the public verify endpoint. No account required. A disclosure that
 *     only the discloser can check is not a disclosure.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ProvenanceStamp, UnsignedStamp } from "./types.js";

export const TTMC_SPEC_VERSION = 1 as const;
export const PROVENANCE_HEADER = "X-TTMC-Provenance";

/**
 * Line endings are normalized before hashing. Without this, the same message
 * fails verification purely from travelling through a Windows clipboard, and
 * a disclosure system that cries wolf gets switched off.
 */
export function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function hashContent(content: string): string {
  return createHash("sha256").update(normalizeContent(content), "utf8").digest("hex");
}

/**
 * Canonical serialization. Newline-delimited and order-fixed so that two
 * implementations in different languages produce byte-identical input to the
 * MAC. Fields are validated to contain no newline for exactly this reason.
 */
export function canonicalize(stamp: Omit<ProvenanceStamp, "sig">): string {
  const persona = stamp.persona ? `${stamp.persona.handle}@${stamp.persona.version}` : "";
  const fields = [
    `TTMC${stamp.v}`,
    stamp.duelId,
    String(stamp.turnIndex),
    stamp.seat,
    stamp.author,
    stamp.model ?? "",
    persona,
    stamp.humanReviewed ? "1" : "0",
    stamp.ts,
    stamp.contentHash,
  ];
  for (const f of fields) {
    if (f.includes("\n")) {
      throw new Error("TTMC-1: canonical fields must not contain newlines");
    }
  }
  return fields.join("\n");
}

function mac(canonical: string, secret: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SignInput extends UnsignedStamp {
  /** The exact turn text. Hashed, never stored inside the stamp. */
  content: string;
}

/** Produce a signed stamp. Call this server-side only. */
export function signStamp(input: SignInput, secret: string): ProvenanceStamp {
  if (!secret) throw new Error("TTMC-1: signing secret is required");
  const { content, ...rest } = input;
  const unsigned: Omit<ProvenanceStamp, "sig"> = {
    ...rest,
    contentHash: hashContent(content),
  };
  return { ...unsigned, sig: mac(canonicalize(unsigned), secret) };
}

export type VerifyFailure =
  | "bad_signature"
  | "content_mismatch"
  | "unsupported_version"
  | "malformed";

export interface VerifyResult {
  valid: boolean;
  failure?: VerifyFailure;
  /** Which key validated it, so rotation is observable. */
  keyGeneration?: "current" | "previous";
  detail?: string;
}

/**
 * Verify a stamp against the message it claims to describe.
 *
 * `secrets` is ordered: current key first, then retired keys still inside
 * their verification window. Signing always uses `secrets[0]`.
 */
export function verifyStamp(
  stamp: ProvenanceStamp,
  content: string,
  secrets: string[],
): VerifyResult {
  if (stamp?.v !== TTMC_SPEC_VERSION) {
    return { valid: false, failure: "unsupported_version", detail: `v=${stamp?.v}` };
  }
  if (!stamp.sig || !stamp.contentHash || !stamp.duelId) {
    return { valid: false, failure: "malformed" };
  }
  if (hashContent(content) !== stamp.contentHash) {
    return {
      valid: false,
      failure: "content_mismatch",
      detail: "the message text does not match the hash this stamp was signed over",
    };
  }

  let canonical: string;
  try {
    canonical = canonicalize(stamp);
  } catch {
    return { valid: false, failure: "malformed" };
  }

  for (const [i, secret] of secrets.entries()) {
    if (!secret) continue;
    if (constantTimeEqual(stamp.sig, mac(canonical, secret))) {
      return { valid: true, keyGeneration: i === 0 ? "current" : "previous" };
    }
  }
  return { valid: false, failure: "bad_signature" };
}

/** Short handle used in verify URLs. Collisions are checked server-side. */
export function stampId(stamp: ProvenanceStamp): string {
  return stamp.sig.slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering: the machine-readable header and the human-readable footer.
// Both must survive a copy-paste, because copy-paste is how this actually
// travels between Slack, Gmail, and whatever else.
// ─────────────────────────────────────────────────────────────────────────────

export function renderHeader(stamp: ProvenanceStamp): string {
  const persona = stamp.persona ? `${stamp.persona.handle}@${stamp.persona.version}` : "";
  const parts = [
    `v=${stamp.v}`,
    `duel=${stamp.duelId}`,
    `turn=${stamp.turnIndex}`,
    `seat=${stamp.seat}`,
    `author=${stamp.author}`,
    `model=${stamp.model ?? ""}`,
    `persona=${persona}`,
    `reviewed=${stamp.humanReviewed ? 1 : 0}`,
    `ts=${stamp.ts}`,
    `hash=${stamp.contentHash}`,
    `sig=${stamp.sig}`,
  ];
  return `${PROVENANCE_HEADER}: ${parts.join("; ")}`;
}

export function parseHeader(line: string): ProvenanceStamp | null {
  const body = line.replace(new RegExp(`^${PROVENANCE_HEADER}:\\s*`, "i"), "").trim();
  if (body === line.trim() && !line.includes("v=")) return null;

  const kv = new Map<string, string>();
  for (const part of body.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    kv.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }

  const get = (k: string) => kv.get(k) ?? "";
  const personaRaw = get("persona");
  const at = personaRaw.lastIndexOf("@");
  const persona =
    personaRaw && at > 0
      ? { handle: personaRaw.slice(0, at), version: Number(personaRaw.slice(at + 1)) || 1 }
      : null;

  const seat = get("seat");
  const author = get("author");
  if (seat !== "A" && seat !== "B") return null;
  if (author !== "agent" && author !== "human" && author !== "system") return null;
  // `unattributed` is intentionally unparseable here: those turns are never
  // signed, so a stamp claiming to describe one is malformed by definition.
  if (!get("sig") || !get("duel")) return null;

  return {
    v: TTMC_SPEC_VERSION,
    duelId: get("duel"),
    turnIndex: Number(get("turn")) || 0,
    seat,
    author,
    model: get("model") || null,
    persona,
    humanReviewed: get("reviewed") === "1",
    ts: get("ts"),
    contentHash: get("hash"),
    sig: get("sig"),
  };
}

const FOOTER_RULE = "─────";

/**
 * Matches any TTMC footer, including ones written by other implementations,
 * so relaying a message through a second hop does not stack disclosures.
 */
export const FOOTER_RE = /^[ \t]*🤖[^\n]*\bverify\b[^\n]*$/gim;

export interface FooterOptions {
  /** "Danilo" → "Danilo's Claude wrote this". */
  displayName: string;
  /** Origin used to build the verify link, e.g. https://talktomyclaude.com */
  publicUrl: string;
}

/**
 * The line a human actually sees. It is one line on purpose: a disclosure that
 * takes a paragraph gets deleted before sending, and a deleted disclosure
 * protects nobody.
 */
export function renderFooter(stamp: ProvenanceStamp, opts: FooterOptions): string {
  if (stamp.author === "human") {
    return `${FOOTER_RULE}\n✍️ Written by ${opts.displayName}, personally. No agent involved.`;
  }
  const reviewed = stamp.humanReviewed
    ? `reviewed by ${opts.displayName}`
    : "not reviewed by a human";
  const url = `${opts.publicUrl.replace(/\/+$/, "")}/v/${stampId(stamp)}`;
  return `${FOOTER_RULE}\n🤖 ${opts.displayName}'s Claude wrote this · ${reviewed} · verify ${url}`;
}

/** Append a disclosure, replacing any that is already there. */
export function withDisclosure(
  content: string,
  stamp: ProvenanceStamp,
  opts: FooterOptions,
): string {
  return `${stripDisclosure(content)}\n\n${renderFooter(stamp, opts)}`;
}

/**
 * Pull a stamp reference out of a message that arrived through some other
 * system — Slack, email, a paste. The footer carries a verify URL ending in the
 * stamp id, which is enough to look the full stamp up and check it against the
 * text it travelled with.
 *
 * This is what makes "detect that their agent wrote this" work in practice: the
 * disclosure we emit is also the marker we read back.
 */
export function extractStampReference(content: string): {
  stampId: string | null;
  header: ProvenanceStamp | null;
} {
  const headerLine = content
    .split(/\r?\n/)
    .find((l) => new RegExp(`^\\s*${PROVENANCE_HEADER}:`, "i").test(l));
  const header = headerLine ? parseHeader(headerLine) : null;
  if (header) return { stampId: stampId(header), header };

  // Footer form: "… · verify https://host/v/<id>"
  const m = content.match(/\bverify\s+\S*?\/v\/([A-Za-z0-9_-]{8,})/i);
  return { stampId: m?.[1] ?? null, header: null };
}

/**
 * Remove TTMC footers and headers from text. Used on inbound relayed messages
 * so the hash is computed over the author's actual words, not over a previous
 * hop's disclosure.
 */
export function stripDisclosure(content: string): string {
  return content
    .replace(FOOTER_RE, "")
    .replace(new RegExp(`^${PROVENANCE_HEADER}:.*$`, "gim"), "")
    .replace(new RegExp(`^[ \\t]*${FOOTER_RULE}+[ \\t]*$`, "gm"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
