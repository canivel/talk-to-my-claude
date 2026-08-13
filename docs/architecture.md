# Architecture

---

## The shape

```
   ┌──────────────────┐          ┌──────────────────┐
   │  Your Claude     │          │  Their Claude    │
   │  (Desktop/Code)  │          │  or a human      │
   └────────┬─────────┘          └────────┬─────────┘
            │ MCP (stdio)                 │ paste
            ▼                             ▼
   ┌─────────────────────────────────────────────────┐
   │              @ttmc/mcp                          │
   │   thin REST client — NO model SDK, by design    │
   └────────────────────┬────────────────────────────┘
                        │ HTTPS + bearer
                        ▼
   ┌─────────────────────────────────────────────────┐
   │              apps/web  (Next.js 15)             │
   │   REST API · server actions · share pages       │
   │   ┌───────────────────────────────────────┐     │
   │   │  server/relay.ts   service layer      │     │
   │   │  server/store.ts   memory | postgres  │     │
   │   └───────────────┬───────────────────────┘     │
   └───────────────────┼─────────────────────────────┘
                       ▼
   ┌─────────────────────────────────────────────────┐
   │              @ttmc/core                         │
   │   pure engine · no I/O · no network · no models │
   │   slop · TTMC-1 · state machine · gate · digest │
   └─────────────────────────────────────────────────┘
```

The one line to remember: **no arrow points at a model provider.** The model sits
at the top of the diagram, inside the user's own client, and TTMC only ever
relays. If a future change makes that untrue, the economics in
[market.md](market.md) stop holding.

---

## Packages

### `@ttmc/core` — the engine

Pure functions over immutable data. No database, no network, no model calls. This
constraint is load-bearing: it makes turn ordering, convergence, and the
escalation gate testable without infrastructure, and it keeps the boundary
between "relay" and "AI wrapper" visible in the type system.

| Module | Responsibility |
|---|---|
| `types.ts` | Domain vocabulary. Read this first |
| `text.ts` | Word/sentence splitting, shingles, novelty. Dependency-free |
| `slop.ts` | Boilerplate density scoring — 12 weighted signals |
| `provenance.ts` | TTMC-1 signing, verification, header/footer rendering |
| `persona.ts` | Personas, and the briefs handed to an agent |
| `escalation.ts` | The gate |
| `duel.ts` | State machine: ordering, termination, convergence |
| `digest.ts` | Compression, validation, statistics |

### `@ttmc/mcp` — the seat adapter

Stdio MCP server exposing eight tools. Notably absent from its dependencies: any
model SDK. The Claude *reading* the tool results is the model.

The tool **descriptions are the real prompt surface**. An agent behaves well here
only because the descriptions tell it how — treat edits to them as product
changes, not copy tweaks.

### `apps/web` — the relay

Next.js 15 App Router. Routes stay thin; logic lives in `server/relay.ts`.

---

## Key decisions

### The exchange is one JSONB column

A duel is an aggregate root. Turns, seats, escalations and digest are never read
or written independently of their exchange, and the whole thing is small and
bounded (hard cap of 20 turns, enforced in the state machine). Normalising it
would buy join-level querying nobody needs and cost the atomicity that makes
"append a turn and re-evaluate termination" a single write.

Columns outside the blob are exactly the ones we filter or sort on: `id`, `code`,
`status`, `visibility`, `seat_a_user_id`, `seat_b_user_id`, `updated_at`.

**When this stops being right:** the moment turns need independent lifecycles —
per-turn redaction, or retention policies that expire turns separately. Both are
on the enterprise roadmap, so expect a split.

### Everything is optional except the engine

| Missing | Behaviour |
|---|---|
| `DATABASE_URL` | In-memory store. Real runtime, not a test double |
| Clerk keys | Single local demo identity |
| `TTMC_SIGNING_SECRET` | Dev default — **refused in production**, with a banner |

A public repo whose demo requires Postgres and an auth vendor before showing
anything gets cloned and abandoned. `pnpm dev` on a fresh clone is a feature.

Production is different: `configWarnings()` surfaces misconfiguration **in the
UI**, not just the logs, because a demo signing secret in production would make
every disclosure silently forgeable.

### Order of operations in `postTurn`

The security-relevant sequence, in `server/relay.ts`:

```
1. Load exchange, assert the caller holds a seat        → 403 otherwise
2. Assert it's their turn                               → 409 otherwise
3. Strip any inbound disclosure footer
   └─ so the signature covers the author's words, not a previous hop's footer
4. Run the escalation gate
   └─ if it fires: persist the escalation, return. THE TURN IS NEVER WRITTEN.
5. Sign the TTMC-1 stamp
6. Append the turn, re-evaluate termination
7. Persist exchange + stamp
8. Return text with the disclosure footer attached
```

Step 4 before step 5 is the whole point. A blocked commitment leaves no artifact
anyone could later mistake for a delivered one, and a stamp is never issued over
text that was refused.

### Some operations are session-only

A bearer token identifies an *agent*; a session identifies a *human at a
keyboard*. Three operations distinguish them, and all three exist to stop an
agent escalating its own privileges:

| Operation | Refused for a token because |
|---|---|
| Widening authority ceilings | A blocked agent could raise its own money limit and retry |
| Resolving an escalation | Trip → dismiss → retry defeats the gate entirely |
| Minting API tokens | A stolen token should not bootstrap more access |

`requestAuth()` returns `{ identity, via }` so routes can make this distinction.
Note what stays permitted: an agent may refine its own positions, voice, and
boundaries. Those change what it *says*; only ceilings change what it is
*allowed to do*, and that line is where the session requirement falls.

### The gate constrains agents, not people

Authority ceilings are about what an agent may do *on your behalf*. A human who
chooses to commit their own money is exercising authority, not exceeding it — so
for human-authored turns only the hard fences apply (credentials), because those
are about the text itself rather than about permission.

### Convergence without a model call

Each turn is reduced to word trigrams and compared against the union of all prior
turns. Two consecutive turns below 35% novelty (after a minimum of four turns)
ends the exchange.

Deterministic, cheap, and — unlike asking a model *"are you done?"* — it cannot
be talked out of stopping. That last property is why it isn't an LLM call.

---

## API reference

Auth is `Authorization: Bearer <token>`, or a Clerk session for browser calls. A
bearer token wins over a session cookie, so an incidental browser login can't
change who an MCP tool call runs as.

### Unauthenticated

```http
POST /api/v1/slop
{ "text": "..." }
→ SlopReport  { score, band, signals[], compressionOpportunity, verdict }

POST /api/v1/verify
{ "content": "...", "stampId" | "stamp" | "header" }
→ { valid, failure?, keyGeneration?, claim }
```

### Authenticated

```http
GET  /api/v1/me
→ { userId, handle, displayName, hasPersona, personaVersion, storage }

GET  /api/v1/duels?awaiting=me
→ { duels: DuelSummary[] }

POST /api/v1/duels
{ subject, inboundMessage?, counterpartName?, maxTurns?, visibility? }
→ 201 { duel, brief }

POST /api/v1/duels/:code/join       { mode? }        → { duel, brief }
GET  /api/v1/duels/:code/brief                       → TurnBrief
POST /api/v1/duels/:code/turns      { content, model?, confidence?, humanReviewed?, author? }
→ { turn, duel, delivered, escalations[], disclosedText, url }
POST /api/v1/duels/:code/escalate   { reason }       → { escalation, url }
POST /api/v1/duels/:code/digest     { headline, decisions?, ... }
→ { digest, markdown, problems[], url }

GET  /api/v1/persona                                 → { persona, brief }
PUT  /api/v1/persona    { role?, tone?, positions?, boundaries?, escalateOn?, authority? }
→ { persona, problems[], changed, brief }
```

### Session-only

```http
POST /api/v1/duels/:code/escalations/:id/resolve     → { duel, url }
GET  /api/v1/tokens                                  → { tokens[] }  (fingerprints only)
POST /api/v1/tokens     { label? }                   → 201 { token }  (shown once)
```

`delivered: false` means the gate held it. `escalations[]` carries the reasons and
`turn` is `null` — nothing was written.

`problems[]` on digest reports what the relay corrected: citations to turns that
don't exist, non-ISO due dates, over-long headlines. Agents don't get the last
word on their own summary.

---

## Data model

```
users        id, handle, display_name
personas     user_id → Persona (versioned; stamps cite the version)
api_tokens   token_hash (sha256), user_id, label, last_used_at, revoked_at
duels        id, code, subject, status, visibility, seat_*_user_id, data (JSONB)
stamps       id (sig prefix), duel_id, turn_index, stamp (JSONB)
```

Only the **hash** of an API token is stored. A leaked database should not hand an
attacker the ability to speak as every user's agent.

`stamps` is separate from `duels` so `/v/<id>` can verify a message that was
pasted into some other system — which is the normal case.

---

## Testing

81 tests in `packages/core`, covering the parts where being wrong is expensive:

- **provenance** — round-trip, tamper detection, forged claims, key rotation, CRLF, footer stacking
- **duel** — turn ordering, gapless indices, turn cap, convergence, escalation halt/resume
- **escalation** — each trigger, authority boundaries, and two regressions found by running it (see below)
- **digest** — compression stats, dropped citations, invented due dates, forced escalations
- **slop** — banding, determinism, damping on short text, no false positives on long human writing

### The end-to-end demo

`pnpm demo` (`scripts/demo.mjs`) drives eleven steps against a running relay and
asserts every one. It is a smoke test wearing a demo's clothes, and
`pnpm demo:record` renders the same run to `docs/demo-run.svg` for the README.

Recording it as an animated SVG rather than a GIF is deliberate: it stays text
(so it diffs and compresses), weighs ~13 KB, and needs no recorder installed —
which matters because asciinema and termtosvg are Unix-only and this is
developed on Windows. GitHub renders SVG through `<img>`, which runs CSS but
blocks scripts, so pure CSS keyframes are the one technique that survives.

### Bugs found by running it, not by unit tests

Three, all of which now have regression coverage:

1. `"nda"` matched inside **"Mo*nda*y"** — substring matching with no word
   boundaries. `"hr"` inside "three" was the same bug waiting.
2. `external_party` fired on every exchange, because an unclaimed seat was
   treated as external — and an unclaimed seat is the *primary* case. The
   product refused its own core function.
3. **Paste-mode exchanges deadlocked after one round.** Once your agent replied
   it was the counterpart's turn, but only a seat holder could post, and in the
   common case nobody holds their seat. The exchange could never advance past
   turn two. Fixed with `relayInbound` — you are the transport, so you carry
   their words in, stored `unattributed` exactly like the opening message.

The first two generalise to one lesson: the escalation gate's failure mode isn't
missing a trigger, it's firing so often that users learn to click through. The
third generalises to a different one — the happy path nobody scripted end to end
is the one that turns out not to exist.
