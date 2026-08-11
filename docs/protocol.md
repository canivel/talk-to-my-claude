# TTMC-1 — Agent Disclosure Stamps

**Version 1 · status: draft · reference implementation: `packages/core/src/provenance.ts`**

A format for making a machine-verifiable, non-repudiable claim about who wrote a
message. Specified in enough detail to reimplement in another language.

---

## Design goals

1. **Non-repudiable.** A participant cannot forge a claim about authorship.
2. **Content-bound.** A stamp cannot be lifted off one message and attached to another.
3. **Independently checkable.** Anyone holding the message can verify it, with no account.
4. **Survives copy-paste.** The transport is a human pasting text between Slack,
   Gmail, and a text box. Anything that doesn't survive that is theatre.

### The threat model, precisely

The interesting forgery is **not** "an agent wrote this" — nobody wants to be
falsely accused of that, so there's no attacker. The forgery that matters is the
inverse:

> **A wants to pass agent-written text off as personally written.**

This single observation determines the design. If stamps were signed
*client-side* with a key the author controls, A could simply sign
`author=human` over agent output and the format would be worthless. Therefore
**stamps are signed by the relay, using a key no participant holds.** The relay
knows which path produced the text and signs what it observed.

The corollary is that TTMC-1 requires trusting the relay. It is a *notarisation*
format, not a peer-to-peer attestation format. Section [Future work](#future-work)
covers what a trustless variant would take.

---

## The stamp

```jsonc
{
  "v": 1,
  "duelId": "duel_r3cshaw3b4dtqpu7gntm",
  "turnIndex": 2,
  "seat": "A",
  "author": "agent",              // "agent" | "human" | "system"
  "model": "claude-opus-5",       // self-declared; null for human-authored
  "persona": { "handle": "danilo", "version": 4 },
  "humanReviewed": false,
  "ts": "2026-08-11T17:59:32.156Z",
  "contentHash": "9f2c…",         // sha256 hex of normalized content
  "sig": "U15nDb2cEI1vnNEv…"      // base64url HMAC-SHA256
}
```

### Field notes

**`author`** is the claim being signed. `unattributed` is deliberately **not** a
valid stamp value: pasted text of unknown origin is stored with *no stamp at
all*. Absence of a stamp means "nobody claimed anything", which is a meaningfully
different statement from a stamp that fails to verify, and both are different
from a stamp asserting human authorship.

**`model`** is self-declared by the seat. The relay cannot verify which model
produced text, and does not pretend to — it relays the claim and signs that *this
claim was made*, not that it is true.

**`persona.version`** is why personas are versioned at all. A stamp asserts which
version of someone's standing positions spoke, and that has to stay checkable
after they edit their persona.

**`humanReviewed`** is only true when a human genuinely approved that exact text.
It is a claim about a person, and it gets cryptographically signed, so
implementations must not set it because the wording looked fine.

---

## Canonicalisation

Newline-delimited, order-fixed, so two implementations produce byte-identical MAC
input:

```
TTMC1
{duelId}
{turnIndex}
{seat}
{author}
{model or ""}
{persona.handle}@{persona.version}   ← or "" if null
{humanReviewed ? "1" : "0"}
{ts}
{contentHash}
```

No field may contain a newline; implementations MUST reject stamps that violate
this rather than producing an ambiguous encoding.

### Content normalisation

Before hashing:

1. `\r\n` → `\n`
2. Strip trailing whitespace from each line
3. Trim leading/trailing whitespace from the whole message

This is not cosmetic. Without it, a message fails verification purely from
travelling through a Windows clipboard — and a disclosure system that cries wolf
gets switched off, which is a worse security outcome than the strictness bought.

```
contentHash = hex(sha256(normalize(content)))
sig         = base64url(hmac_sha256(canonical, secret))
```

---

## Verification

```
1. Reject unless v == 1                                    → unsupported_version
2. Reject if sig, contentHash, or duelId is missing        → malformed
3. Recompute sha256(normalize(content)).
   Mismatch                                                → content_mismatch
4. Recompute canonical form; reject on newline violation   → malformed
5. For each key in [current, ...retired]:
     constant-time compare against hmac(canonical, key)
   No match                                                → bad_signature
```

Order matters: **content is checked before signature.** It distinguishes "this
text was altered" from "this stamp is fake", and those need different messages to
a user.

Comparison MUST be constant-time.

### Key rotation

Keys are an ordered list. Signing always uses the first; verification tries all.
Rotation is therefore not a cliff — previously issued stamps keep verifying while
retired keys stay in the window. `keyGeneration` in the result reports which key
matched, so rotation is observable.

---

## Wire formats

### Header — machine-readable

```
X-TTMC-Provenance: v=1; duel=duel_r3c…; turn=2; seat=A; author=agent;
  model=claude-opus-5; persona=danilo@4; reviewed=0; ts=2026-08-11T17:59:32.156Z;
  hash=9f2c…; sig=U15nDb2cEI1vnNEv…
```

Round-trips losslessly through parse/render. Suitable for email headers and
structured channels.

### Footer — human-readable

```
─────
🤖 Danilo's Claude wrote this · not reviewed by a human · verify https://…/v/U15nDb2cEI1
```

One line, on purpose. A disclosure that takes a paragraph gets deleted before
sending, and a deleted disclosure protects nobody.

Human-authored turns render differently, because the useful signal is the
contrast:

```
─────
✍️ Written by Danilo, personally. No agent involved.
```

### Stripping

Implementations MUST strip existing TTMC footers and headers from inbound text
before hashing. Without it, relaying through a second hop stacks disclosures and
the signature covers a previous hop's footer rather than the author's words.

```
FOOTER_RE = /^[ \t]*🤖[^\n]*\bverify\b[^\n]*$/gim
```

Written to match footers from *other* implementations too, not just this one.

---

## Verify endpoint

```http
POST /api/v1/verify
{ "content": "…", "stampId": "U15nDb2cEI1vnNEv" }
```

Accepts a `stamp` object, a raw `header` string, or a `stampId`. Always requires
`content` — a stamp is meaningless except against the text it was signed over.

```jsonc
{
  "valid": true,
  "keyGeneration": "current",
  "claim": {
    "author": "agent",
    "model": "claude-opus-5",
    "persona": { "handle": "danilo", "version": 4 },
    "humanReviewed": false,
    "signedAt": "2026-08-11T17:59:32.156Z"
  }
}
```

**This endpoint MUST be unauthenticated.** The person who most needs it is the
recipient of a message pasted into some other system — someone with no account
who will never have one. A disclosure only the discloser can check is not a
disclosure.

---

## What TTMC-1 does not claim

Worth stating, because disclosure formats invite over-reading:

- **Not that the model claim is true.** `model` is self-declared.
- **Not that unstamped text is human.** It means nobody made a claim. This is the
  most common misreading and implementations should present it carefully.
- **Not that the content is accurate**, only that a specific party asserted a
  specific authorship claim over exactly these words at a specific time.
- **Not a detector.** The slop score is a separate, explicitly heuristic measure
  of *style*, and must never be presented as evidence of authorship.

---

## Future work

**Public-key stamps.** HMAC means verification requires the relay. Ed25519 with
published relay keys would let anyone verify offline, at the cost of a key
distribution story. This is the obvious v2.

**Trustless attestation.** Removing trust in the relay entirely would need
attestation from the model provider — signed inference receipts. That doesn't
exist today from any vendor. If it ever does, TTMC-1 v3 should carry it.

**Revocation.** No way to revoke a stamp after issuance. Probably correct — a
disclosure you can retract isn't much of a disclosure — but worth revisiting for
retention-policy reasons in enterprise deployments.

**Cross-relay federation.** Two organisations running separate relays cannot
currently verify each other's stamps. Solved by public-key stamps plus a relay
discovery mechanism.
