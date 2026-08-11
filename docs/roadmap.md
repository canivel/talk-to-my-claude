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

## Next — proving the thesis

Everything here exists to answer *"is the digest independently valuable?"*, which
is the question the whole product rests on.

- **Persona editor.** Currently a persona is auto-created and restrictive. Without
  a UI to write standing positions, agents have nothing to represent and the
  answers stay generic. **This is the highest-leverage missing piece.**
- **Escalation resolve flow in the UI.** The state machine supports resume
  (`resolveEscalation`); the web app has no button for it. An escalated exchange
  is currently a dead end in the browser.
- **Metrics.** Median compression, escalation rate, second-seat claim rate, mean
  turns over time. The success criteria in [market.md](market.md#what-would-tell-us-this-is-working)
  are unmeasurable until this exists — including the one that would tell us we're
  becoming the problem.
- **Slop calibration corpus.** A labelled set plus a way for users to report a
  wrong score. This is the asset that compounds.

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
