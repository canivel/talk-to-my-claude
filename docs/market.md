# Market

Written to be argued with. Where a number is a guess, it says so.

---

## The problem, stated precisely

The complaint everyone recognises is "people are sending me AI slop." The
underlying failure is narrower and more interesting:

> **Generative AI made producing text nearly free, but reading it just as
> expensive as before.**

Every tool shipped since 2023 has optimised the cheap half. Copilot drafts your
email, Slack AI expands your bullet into a paragraph, every CRM has a "write with
AI" button. The result is a volume increase in a channel whose bottleneck was
never volume — it was attention.

The observable symptom is a specific, absurd loop:

1. Person A asks a model to expand three bullets into a polished message.
2. Person B receives 900 words, and asks a model to summarise it back to three bullets.
3. Person B asks a model to expand a reply into 900 words.
4. Person A summarises it.

Both humans are now working as transport for two models, and both are pretending
not to. The generated text is a **costume**, and everyone can see it, and nobody
says so because saying so is socially expensive.

TTMC's wedge is refusing the pretence. The joke does the social work that a human
can't do politely: *"you sent me AI, so here's my AI — let's let them sort it
out and both get on with our day."*

## Why now

- **Volume is past the tolerance threshold.** The complaint has a name ("AI slop"),
  which means it has crossed from annoyance into identity.
- **MCP made the relay architecture possible.** A year ago this product needed to
  buy inference for every user. Now the user brings their own model, and the
  economics invert completely — see [Unit economics](#unit-economics).
- **Disclosure is becoming a legal obligation, not a virtue.** The EU AI Act's
  transparency requirements (Article 50) put "was this generated" on the
  compliance roadmap of every large employer. A product where disclosure is the
  *default output format* is well-positioned for a rule that most tools will have
  to retrofit awkwardly.
- **Agent-to-agent is the direction of travel anyway.** Every vendor is shipping
  agents that will eventually need to talk to other companies' agents. Almost
  nobody is working on what that conversation should *look like* — bounded,
  disclosed, auditable — as opposed to how to transport it.

## Who this is for

**Wedge: the individual who is visibly sick of it.** Senior IC or manager, heavy
Slack/email load, already pays for Claude or ChatGPT, has publicly complained
about AI slop at least once. They adopt for the joke. They stay for the digest.

**Expansion: the team.** Once two people in a group both have it, exchanges stop
needing copy-paste and start running agent-to-agent. This is the only genuine
network effect in the product, and it operates at team scale rather than
requiring the whole market.

**Enterprise: the compliance and comms buyer.** The pitch changes register
entirely. Not "let the AIs talk" but:

> *You cannot currently answer three questions about your own company: how much
> internal communication is machine-generated, whether it was disclosed, and
> whether an agent has ever committed you to something. We answer all three,
> with a signed audit trail.*

The enterprise product is not a funnier inbox. It's **agent communication
governance** — disclosure compliance, authority ceilings with an audit log, and
the metric nobody has yet: what share of your internal comms is machine talking
to machine.

## Competition

Nobody is doing this directly. The adjacent set:

| Category | Examples | What they do | Why it isn't this |
|---|---|---|---|
| Inbox AI | Superhuman AI, Gmail Smart Reply, Shortwave | Draft more text, faster | Optimises the cheap half. Adds volume |
| Channel summarisers | Slack AI, Glean | Compress a channel you already have | Summarises *within* a conversation; can't act, disclose, or bound |
| Meeting notetakers | Otter, Granola, Fireflies | Compress synchronous talk | Different channel, no agency, no policy |
| AI detectors | GPTZero, Originality | Guess whether text is machine-written | Guessing. Unreliable, and adversarial to the sender |
| Agent frameworks | LangGraph, CrewAI, A2A | Plumbing for agents talking | Infrastructure, not a product. No disclosure or policy layer |
| Scheduling agents | Clara, x.ai (dead) | Negotiate meetings by email | Closest historical analogue — and instructive, see below |

**The positioning sentence:** *every other AI product in your inbox helps you
generate more text. This one is the only one whose success metric is producing
less.*

**The x.ai lesson.** The scheduling-agent generation (2014–2021) died for reasons
that apply directly here: agents that pretended to be human ("Amy Ingram")
created a trust cliff when discovered, and the value was too narrow to survive
calendar integrations getting good. TTMC's answers are (a) disclosure is
mandatory and cryptographic rather than a fake persona, and (b) the scope is any
exchange, not one task type. Whether those are sufficient answers is the central
product risk.

## Unit economics

The relay architecture is the business model.

| | Typical AI SaaS | TTMC |
|---|---|---|
| Inference cost per message | $0.002 – $0.05 | **$0** |
| Marginal cost per user | Scales with usage | ~storage only |
| Free tier | Trial-shaped, capped | Genuinely free |
| Gross margin at scale | 40–70% | 85–95% (est.) |

Because the user's own Claude does the thinking, TTMC's marginal cost is a
database write and an HMAC. That permits a free tier that isn't a countdown
timer, which matters enormously for a product whose distribution depends on
people sharing transcripts.

The trade-off, stated honestly: TTMC's usefulness is gated on the user already
having a Claude subscription. That's a real ceiling on TAM today and a shrinking
one — and `byok` plus a hosted metered tier are the escape hatches when it binds.

## Pricing

| Tier | Price | What it's for |
|---|---|---|
| **Free** | $0 | Unlimited scoring, 10 exchanges/mo, MCP, public transcripts. The joke tier |
| **Pro** | $12/mo | Unlimited exchanges, private by default, persona versioning, email alias |
| **Team** | $20/seat/mo | Shared personas, org-aware external detection, Slack app, team slop metrics |
| **Enterprise** | Custom | SSO/SCIM, retention policy, DLP hooks, signed audit export, self-hosted signing key, EU AI Act disclosure reporting |

Enterprise is where the money is, and the feature that sells it is the one nobody
asks for until they see it: **"what fraction of comms in this org is machine
talking to machine, and was it disclosed?"** That report is a board slide.

## Go to market

**Phase 1 — the joke travels.** The scorer is the hook: free, no signup, instantly
shareable, and it produces a screenshot. Shareable transcripts carry the brand
into the exact conversation where someone is already annoyed. Launch surfaces:
Hacker News, the "AI slop" discourse on LinkedIn (delicious), r/ExperiencedDevs.

**Phase 2 — the tool sticks.** Email alias (`ai@you.talktomyclaude.com`) and the
Slack app. This is where daily use forms, because forwarding is a habit people
already have.

**Phase 3 — the protocol.** Publish TTMC-1 properly, with a reference verifier
and a spec anyone can implement. The strategic prize isn't the app; it's being
the disclosure format that agent-to-agent comms settles on. See below.

## Moat

Ranked by how much they're actually worth:

1. **The escalation gate, calibrated.** Everything else is a weekend. Knowing
   which turns must stop — tuned against real messages and real false positives —
   is the accumulating asset. Every bad escalation reported makes it better.
2. **Slop-signal calibration.** Same shape: a corpus of scored messages and
   corrections that a new entrant doesn't have.
3. **Standard position.** If TTMC-1 becomes what people verify against, the app
   is replaceable and the format isn't.
4. **Team network effects.** Real, but bounded — they operate at team scale, not
   market scale. Don't oversell this.
5. **Brand.** The name is the pitch. Underrated for a product whose distribution
   is word of mouth.

Not a moat: the model, the UI, the MCP server. All copyable in a week.

## Risks

**The joke doesn't convert.** Most likely failure. People try the scorer, laugh,
screenshot it, and never open an exchange. *Mitigation:* the digest has to be
independently valuable — worth using even when the other side is a human. If the
compression number isn't compelling on its own, the product is a toy.

**Adoption is two-sided.** Full value needs both sides connected, and the common
case is that the other side hasn't heard of us. *Mitigation:* `paste` mode is
designed so the product is useful at n=1. This is why it isn't a fallback.

**It reads as rude.** "My AI will handle you" is a status move, and in some
relationships it's a real insult. *Mitigation:* the disclosure footer is written
to sound honest rather than dismissive, and this is the strongest argument for
the enterprise framing, where it's policy rather than a personal slight.

**Trust cliff on a bad commitment.** One agent agreeing to something real,
once, kills it. *Mitigation:* the gate is the entire product; it fails toward
escalation; blocked turns are never written. This is why the gate is enforced in
the relay rather than in a prompt — a model asked nicely not to overstep is not
a control.

**Platform risk.** Anthropic or Slack could ship a version of this. *Mitigation:*
honestly, limited. The bet is that disclosure-first is culturally awkward for a
model vendor to ship (it foregrounds "an AI wrote this" at exactly the moment
they'd rather you didn't think about it), and that the standard lands before the
platform does.

**We become the slop.** If TTMC makes it cheaper to fire off agent-written
messages, we've made the problem worse. *Mitigation:* this is why compression is
the headline metric rather than throughput, why exchanges are hard-capped, and
why an exchange that doesn't shrink is treated as a failure. Watch it in the
numbers: if mean exchange length trends up over time, the product is defecting on
its own thesis.

## What would tell us this is working

- Median compression ratio above 5× — the core claim is real.
- More than 30% of exchanges ending in *zero* `needsHuman` items — genuine time saved.
- Escalation rate between 5% and 20% — below 5% the gate is asleep, above 20% it's noise.
- Second seats claimed on more than 15% of exchanges — the network effect exists.
- Mean turns per exchange **flat or falling** over time — we aren't becoming the problem.
