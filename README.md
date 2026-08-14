# Talk To My Claude

![Four-panel comic. Human A receives a wall of AI-written text, cannot be bothered to read it, and copies it onward. Human B pastes it into their Claude. Claude writes a reply. Human A copies that back, wondering whether they just received the other person's Claude answering their own Claude.](image.png)

**You sent me AI. Here's my AI. :)**

Half the messages in your inbox were written by a language model. The reply you're
about to send will be too. You are the copy-paste layer between two machines that
could have settled this themselves — and you're doing it while pretending not to.

So stop pretending. Forward the message here, let the agents settle it on the
record, and get back the two sentences that actually needed you.

```
Their AI  ──────►  ┌─────────────────┐  ──────►  Your Claude
   900 words       │  TTMC  relay    │           (your subscription,
                   │  · disclosure   │            your persona,
                   │  · policy gate  │            your positions)
   38 words        │  · compression  │
You  ◄──────────── └─────────────────┘  ◄──────── 
   the digest
```

It started as a joke about Slack. It turns out the boring version — signed
disclosure, enforced authority limits, and a hard cap on how long two agents may
talk — is a real piece of infrastructure.

---

## See it run

Seven steps against a real relay — no inference key anywhere in the run.

![Animated recording of the demo, one step at a time: setting up a persona with a $25,000 ceiling; scoring an inbound message at 54/100 boilerplate; the agent replying in 27 words and the relay signing it; that signature verifying, then failing after a single sentence is edited; pasting the counterpart's reply in on their behalf; the escalation gate holding a $90,000 commitment and refusing the agent when it tries to raise its own ceiling; and the whole exchange compressing to 22 words.](docs/demo-run.svg)

```bash
pnpm dev        # one terminal
pnpm demo       # another
```

`pnpm demo` is also a smoke test: every step asserts, and it exits non-zero the
moment reality stops matching the story. A demo that can quietly drift out of
sync with the product is worse than none, because it keeps looking convincing
after it stops being true. It has already earned that — writing it is what
surfaced the
[paste-mode deadlock](docs/architecture.md#bugs-found-by-running-it-not-by-unit-tests).

---

## Detecting their AI, and answering it automatically

The Slack case: someone sends you an AI-written message, TTMC notices, and your
Claude answers — in the thread, disclosed.

**There is no fingerprint in Claude's output to look for.** Anthropic does not
watermark text, and neither does anyone else worth relying on: SynthID-Text
marks Gemini, C2PA covers images, and commercial "AI detectors" are style
classifiers with false-positive rates that land hardest on non-native English
writers.

So TTMC does not hunt for a secret in the words. It reads back the signature
**it** put there:

| Tier | Signal | Certainty | May trigger an automatic reply? |
|---|---|---|---|
| 1 | TTMC-1 signature, verified | **Exact** | **Yes** — the default bar |
| 2 | Vendor watermark | Exact | If one ever ships. Registry is empty |
| 3 | Boilerplate score | Probabilistic | **No**, unless you lower the bar yourself |

And detection is only half the decision. *Did a machine write this* and *should
a machine answer it* are different questions, so the inbound message runs the
escalation gate too. Contracts, conflict, credentials, money over your ceiling,
and anything you fenced off in your persona are never auto-answered however
confidently a machine is detected.

```bash
SLACK_SIGNING_SECRET=demo-slack-signing-secret TTMC_AUTOROUTE=1 TTMC_AUTOROUTE_CHANNELS=C_ENG pnpm dev

pnpm demo:slack
```

Five signed Slack events: a forged request rejected at `401`, a human ignored,
obvious slop flagged but **not** answered, a signed agent message auto-answered,
and a signed agent message about a fenced subject held back. **One of five gets
answered automatically** — that ratio is the design working, not failing.

Full detail, including real Slack setup and the known gaps:
[docs/detection.md](docs/detection.md).

---

## The one architectural decision that matters

**TTMC never holds an inference API key.** It is a relay, not another AI wrapper.

Your own Claude connects to it over [MCP](https://modelcontextprotocol.io) and
writes the replies itself, so the thinking happens inside the subscription you
already pay for. The relay does transport, identity, policy, signatures, and
compression — and nothing else.

Three consequences, all of them the point:

- **No per-message cost**, so the free tier is genuinely free rather than
  trial-shaped.
- **Your transcripts never pass through a model vendor we picked for you.**
- **It works with the AI you already have**, instead of asking you to adopt one more.

A seat in an exchange can be filled three ways:

| Mode | Who runs the model | When it applies |
|---|---|---|
| `mcp` | Your Claude, over MCP | Both sides connected — true agent-to-agent |
| `paste` | A human relaying text | **The common case.** They've never heard of TTMC and are pasting from their own chat window |
| `byok` | Server-side, your provider key | Async exchanges that advance while you sleep *(roadmap)* |

The `paste` mode is not a fallback, it's the on-ramp. The whole premise is that
the other side hasn't adopted anything.

---

## Quick start

```bash
git clone https://github.com/canivel/talk-to-my-claude
cd talk-to-my-claude
pnpm install
pnpm --filter @ttmc/core build
pnpm dev
```

Open <http://localhost:3000>. That's the whole setup — **no database, no Clerk
account, no API key**. With an empty `.env` the app runs on in-memory storage
and a single local demo identity, because a repo that demands three services
before it shows you anything gets cloned and abandoned.

For anything real, copy `.env.example` to `.env` and set `TTMC_SIGNING_SECRET`,
`DATABASE_URL`, and your Clerk keys. The app refuses to start silently on demo
defaults in production — it shows a banner saying exactly what's misconfigured.

### Connect your Claude

1. Go to `/settings/connect` and mint a token.
2. Add to your Claude Desktop / Claude Code MCP config:

```json
{
  "mcpServers": {
    "talk-to-my-claude": {
      "command": "npx",
      "args": ["-y", "@ttmc/mcp"],
      "env": {
        "TTMC_API_URL": "http://localhost:3000",
        "TTMC_TOKEN": "ttmc_..."
      }
    }
  }
}
```

3. Forward your Claude something an AI clearly wrote at you and say *"deal with this."*

No MCP? The exchange page gives you a brief to paste into any Claude window and a
box to paste the reply back. Same signatures, same gate, one extra step.

---

## What it actually does

### 1. Scores the boilerplate

Paste in what they sent. You get 0–100 with the specific tells that fired:
house-style vocabulary, hedging, compulsive triads, bolded bullet scaffolding,
uniform sentence rhythm, ceremonial openers, the "it's not just X, it's Y"
construction.

> **This is not an AI detector, and we will never call it one.** It measures the
> *text*, not the author. Heavily-edited model output scores low; a human who
> writes in corporate register scores high. That's correct behaviour — statistical
> authorship detection is unreliable, and false accusations of "you used AI" do
> real damage. For authorship there is exactly one honest answer, and it's a
> signature, not a guess.

### 2. Answers from your actual positions

Your persona carries your standing positions, your voice, your boundaries, and
your authority ceilings. Your agent asserts what you've already decided instead
of improvising something agreeable.

### 3. Stops at the fence

Before a turn is signed or written, the escalation gate checks it:

| Trigger | Fires when |
|---|---|
| `money_over_authority` | Commits an amount above your ceiling |
| `time_commitment` | Accepts a meeting or deadline you didn't delegate |
| `scope_commitment` | Agrees to take on work |
| `legal_or_contractual` | Touches contracts, NDAs, liability — regardless of settings |
| `credentials_or_secrets` | Contains a live credential. **Blocked outright, always** |
| `interpersonal_conflict` | Real conflict or emotional content — regardless of settings |
| `persona_boundary` | Crosses a fence you wrote yourself |
| `low_confidence` | Your agent is under 40% sure |

A turn that trips the gate is **never written to the transcript**, so a blocked
commitment leaves no artifact anyone could later mistake for a delivered one.

The last two rows are unconditional. If your colleague is upset, that isn't a
routing problem, and no configuration will let an agent smooth it over.

### 4. Compresses, instead of expanding

Every other AI feature in your inbox generates more text than it consumes. This
one runs the arrow backwards. When an exchange converges or hits its turn cap, it
collapses into decisions, open questions, and what needs a human:

```
87 words in → 34 words out (2.6× compression) over 2 turns. Mean boilerplate score 21/100.
```

Compression is computed by the relay from the real transcript, never taken from
the agent's word. Agents also don't get to invent due dates — non-ISO dates are
dropped and reported.

### 5. Signs the disclosure

Every agent-written turn carries a [TTMC-1](docs/protocol.md) stamp: HMAC-signed
server-side, bound to a hash of the exact wording, verifiable by anyone at
`/v/<id>` with no account.

```
─────
🤖 Danilo's Claude wrote this · not reviewed by a human · verify https://…/v/U15nDb2cEI1
```

Server-side signing is the load-bearing detail. Nobody wants to forge *"an agent
wrote this"* — the forgery that matters is **"a human wrote this"**, and only the
relay holds the key.

Pasted inbound messages are stored **unsigned**, deliberately. We know someone
pasted them and nothing more. Asserting who wrote them would undermine every
signature we do issue.

---

## Bounded by construction

Two agents left alone will happily produce forty courteous turns, which is
strictly worse than the problem we set out to solve. So exchanges stop:

- **Turn cap** — default 6, hard maximum 20.
- **Convergence detection** — each turn is reduced to word trigrams and compared
  against everything said before it. When consecutive turns stop introducing new
  material, the agents are restating rather than progressing, and it ends.

Convergence is deterministic and needs no model call — which also means, unlike
asking a model *"are you done?"*, it cannot be talked out of stopping.

---

## Repo layout

```
packages/core     Relay engine — pure, no I/O. Slop scoring, TTMC-1 signing,
                  state machine, escalation gate, digest. 81 tests.
packages/mcp      MCP stdio server. Talks REST, never touches a model SDK.
apps/web          Next.js 15 · Clerk (optional) · Drizzle/Postgres (optional)
docs/             Market analysis, architecture, protocol spec, roadmap
```

```bash
pnpm test         # 81 tests across the core engine
pnpm typecheck    # all three packages
pnpm build        # core → mcp → web
```

The engine is deliberately free of I/O — no database, no network, no model calls.
Keeping that boundary visible in the type system is what stops this drifting into
being another wrapper.

---

## API

Full reference in [docs/architecture.md](docs/architecture.md).

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/slop` | none | Score text for boilerplate |
| `POST /api/v1/verify` | none | Verify a disclosure stamp against its message |
| `GET /api/v1/duels?awaiting=me` | bearer | What's waiting on you |
| `POST /api/v1/duels` | bearer | Open an exchange |
| `GET /api/v1/duels/:code/brief` | bearer | Persona + policy + transcript for your turn |
| `POST /api/v1/duels/:code/turns` | bearer | Take your turn (runs the gate, signs, discloses) |
| `POST /api/v1/duels/:code/escalate` | bearer | Hand back to your human |
| `POST /api/v1/duels/:code/digest` | bearer | Submit the compressed summary |
| `GET·PUT /api/v1/persona` | bearer¹ | Read or refine your persona |
| `POST /api/v1/duels/:code/escalations/:id/resolve` | **session** | Clear an escalation and resume |
| `GET·POST /api/v1/tokens` | **session** | List or mint API tokens |

`/slop` and `/verify` are unauthenticated on purpose. The person who most needs
the verifier is the recipient of a message pasted into some other system —
someone who has never heard of TTMC and never will. A disclosure only the
discloser can check is not a disclosure.

### Some things an agent is not allowed to do

¹ Three operations require a **signed-in browser session** and are refused for a
bearer token, because an agent holding one must not be able to escalate its own
privileges:

- **Widening its own authority ceilings.** Otherwise an agent blocked by the gate
  could raise its money limit and retry, turning the control into a speed bump.
  It *can* refine its positions, voice, and boundaries — just not the limits it
  is checked against.
- **Resolving its own escalation.** Trip it, dismiss it, retry would defeat the
  entire mechanism. Resolving is an act of human judgement.
- **Minting tokens.** A stolen token grants what that token was scoped to, and no
  ability to bootstrap more.

---

## Where this could go wrong

Stated plainly, because a product in this space that doesn't say them is hiding
something.

**It could be used to hide AI rather than disclose it.** So disclosure isn't
optional and isn't client-side. The relay signs server-side; you cannot strip the
stamp and keep the verification, and you cannot forge the human claim.

**An agent could commit you to something.** So authority ceilings are checked
before signing, not after, and blocked turns are never written at all.

**Two agents could talk forever.** So exchanges are bounded twice over.

**Some conversations should never be automated.** Conflict, performance, anything
contractual. Those escalate unconditionally.

**If both sides adopt this, have you automated away the relationship?** Sometimes
— and sometimes the relationship was already two people forwarding each other
generated text. The honest claim is narrow: TTMC is for the exchanges that were
*already* AI-to-AI theatre. It is not for the ones that matter, and the escalation
gate exists to keep telling the difference.

---

## Status

Working, and early. The engine and the MCP server are solid and tested; the web
app is a real implementation rather than a mock. Not yet built: Slack and email
adapters, org-aware external-party detection, `byok` seats, retention policy.
See [docs/roadmap.md](docs/roadmap.md).

Contributions welcome, particularly slop-signal calibration — if you have a
message that scores wrong, that's a bug and a test case.

## Docs

- [Market analysis](docs/market.md) — who this is for, what it competes with, how it makes money
- [Architecture](docs/architecture.md) — how the pieces fit, and why the exchange is one JSONB column
- [Detection](docs/detection.md) — how a machine-written message is spotted, and when it is deliberately not answered
- [TTMC-1 protocol](docs/protocol.md) — the disclosure spec, in enough detail to reimplement
- [Roadmap](docs/roadmap.md)

## License

MIT
