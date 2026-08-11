# Roadmap

Ordered by whether it's needed to know if the product works, not by difficulty.

---

## Shipped

- **Relay engine** (`@ttmc/core`) — slop scoring, TTMC-1 signing, exchange state
  machine, escalation gate, digest compression. 81 tests.
- **MCP server** — eight tools, your Claude takes a seat, no inference key anywhere.
- **Web app** — landing + live scorer, paste flow, transcript/share page, public
  verifier, dashboard, token minting.
- **REST API v1** — the full surface the MCP server runs on.
- **Zero-setup dev** — in-memory store and demo identity, so `pnpm dev` works on a
  fresh clone.
- **Persona editor** — standing positions, boundaries, voice, and authority
  ceilings, with a live preview of the exact brief the agent receives. Versioned,
  and a no-op save does not bump the version that disclosure stamps cite.
- **Escalation resolve flow** — an escalated exchange is resumable rather than a
  dead end, and the turn goes back to the seat that was blocked.
- **Metrics** — the success criteria from [market.md](market.md#what-would-tell-us-this-is-working)
  measured rather than asserted, thresholds encoded in `packages/core/src/metrics.ts`
  so the claim and the number cannot drift apart.
- **Privilege separation** — agents cannot widen their own authority ceilings,
  resolve their own escalations, or mint tokens.

## Next — proving the thesis

Everything here exists to answer *"is the digest independently valuable?"*, which
is the question the whole product rests on.

- **Slop calibration corpus.** A labelled set plus a way for users to report a
  wrong score. This is the asset that compounds.
- **Persona onboarding.** The editor exists, but a blank persona is still the
  default. Extracting a first draft from a few of the user's own sent messages
  would remove the one step most likely to be skipped.
- **MCP persona tools.** `/api/v1/persona` exists; the MCP server does not expose
  it yet. "Claude, add 'no meetings before 10' to my persona" should just work —
  and the API already refuses the authority fields, so the boundary holds.
- **Digest quality.** Nothing currently measures whether a digest was *accurate*,
  only whether it was short. A thumbs-down that records which turn was
  misrepresented would close that loop.

## Then — distribution

- **Email alias.** `ai@you.talktomyclaude.com`. Forwarding is a habit people
  already have, which makes this the highest-conversion surface. Needs inbound
  mail (Postmark/Resend) and threading.
- **Slack app.** `/ttmc` on a thread. The enterprise wedge. Needs OAuth, app review.
- **Chrome extension.** Right-click → send to my Claude, on LinkedIn/Gmail/Teams.
  Best distribution, most surface to maintain.
- **`byok` seats.** Server-side agent with the user's own provider key, so
  exchanges advance while they sleep. First time TTMC touches a model SDK —
  isolate it hard, behind the existing seat-mode boundary.

## Then — enterprise

- **Org model.** Real membership, which turns on genuine `external_party`
  detection. Currently stubbed to `false` precisely because guessing was worse
  than not answering.
- **Shared personas + team defaults.** Authority ceilings set by policy rather
  than by each individual.
- **Retention and per-turn redaction.** This is what forces the exchange
  aggregate out of a single JSONB column — see
  [architecture.md](architecture.md#the-exchange-is-one-jsonb-column).
- **Signed audit export.** The compliance artifact: every agent-written message,
  its authority context, and its disclosure, in a verifiable bundle.
- **Disclosure reporting.** *"What share of comms in this org is machine talking
  to machine, and was it disclosed?"* The board slide. This is what sells the tier.
- **SSO/SCIM, DLP hooks, self-hosted signing key.**

## Protocol

- **Publish TTMC-1** with a reference verifier in more than one language.
- **Public-key stamps (v2).** Ed25519 with published relay keys, so verification
  no longer requires the relay. The obvious next version — see
  [protocol.md](protocol.md#future-work).
- **Cross-relay federation.** Two orgs, two relays, mutual verification. Needs v2 first.

---

## Explicitly not doing

- **Group exchanges.** Two seats is a constraint that makes convergence
  meaningful. Three-way agent conversations are a different product.
- **Our own model.** The moment TTMC buys inference, the margin story and the
  privacy story both collapse. `byok` is the deliberate limit.
- **AI detection as a product.** The slop score measures style and says so.
  Selling it as authorship detection would be dishonest and, worse, wrong.
- **Auto-send without disclosure.** Asked for eventually, guaranteed. The answer
  is no; it inverts the entire premise.
