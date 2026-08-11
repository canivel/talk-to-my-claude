# GitHub repo metadata

Copy-paste ready.

---

## Description (the ~350-char field under the repo name)

**Recommended:**

> You sent me AI. Here's my AI. A disclosure-first relay that lets two people's agents settle it, then hands the humans back only what actually needed a decision. Never holds an API key — your own Claude takes a seat over MCP.

**Shorter, if you want the joke to land faster:**

> Tired of people routing AI at you through Slack and email? Route it back. Signed disclosure, enforced authority limits, and a hard cap so two agents can't talk forever. Your Claude connects over MCP — we never hold an API key.

**Enterprise-leaning:**

> Agent-to-agent communication with signed disclosure, authority ceilings, and bounded exchanges. Every machine-written message is cryptographically attributable and independently verifiable. Relay architecture — no inference keys held.

---

## Website

```
https://talktomyclaude.com
```

## Topics

```
ai · mcp · model-context-protocol · claude · anthropic · ai-agents
agent-to-agent · disclosure · provenance · ai-transparency · ai-slop
typescript · nextjs · eu-ai-act · productivity
```

---

## Social preview card

**Headline:** You sent me AI. Here's my AI.
**Sub:** Signed, disclosed, and capped at six turns.

Use the landing-page palette: `#07080a` background, `#f5a623` accent on
"Here's my AI", monospace. The 900-words-in / 38-words-out arrow diagram from the
README works well as the visual.

---

## Pinned issues to open at launch

1. **`good first issue` — Slop signal calibration.** "Found a message that scores
   wrong? Post it here." Turns the weakest part of the product into the
   contribution path, and builds the labelled corpus that is the actual moat.
2. **`discussion` — What should never be automated?** The escalation gate's
   unconditional triggers (conflict, contractual, credentials). Getting this list
   right matters more than any feature, and it benefits from arguments.
3. **`help wanted` — TTMC-1 verifiers in other languages.** Python, Go, Rust. The
   spec in `docs/protocol.md` is written to be reimplementable.

---

## Release note — v0.1.0

> **v0.1.0 — the joke, taken seriously**
>
> A working relay that lets your Claude answer someone else's AI, on the record.
>
> - **Boilerplate scorer** — 12 weighted signals, deterministic, with evidence.
>   Not an AI detector, and we say so in the UI.
> - **TTMC-1 disclosure stamps** — HMAC-signed server-side, bound to a content
>   hash, verifiable by anyone at `/v/<id>` with no account.
> - **Escalation gate** — money, calendar, scope, contracts, credentials,
>   conflict. Runs *before* signing; blocked turns are never written.
> - **Bounded exchanges** — turn cap plus model-free convergence detection.
> - **MCP server** — your Claude takes a seat. We never hold an API key.
> - **Zero-setup dev** — `pnpm dev` on a fresh clone. No database, no auth vendor.
>
> 81 tests. Two of the bugs they now cover were found by driving a live server:
> `"nda"` matching inside "Mo**nda**y", and the external-party check firing on
> every exchange. Both are in `docs/architecture.md` under Testing.
