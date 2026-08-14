# Detecting that a machine wrote it

The Slack use case: someone sends you an AI-written message, TTMC notices, and
your Claude answers it. This is how the noticing works, and where it refuses to.

---

## There is no fingerprint in Claude's output

Worth stating first, because the whole design follows from it.

**Anthropic does not put a watermark or fingerprint in Claude's text.** There is
no marker in the words to look for. The same is true of GPT and of essentially
every deployed chat model.

- **SynthID-Text** (Google DeepMind) is real and open-sourced, but it marks
  Gemini output, and only when the generating provider applies it. It says
  nothing about Claude.
- **C2PA** covers images and media. Not chat messages.
- **Commercial "AI detectors"** are statistical classifiers over style. They
  have well-documented false-positive problems, and those errors land hardest on
  non-native English writers. Acting on that automatically would be
  irresponsible, and accusing a colleague on the strength of it would be worse.

So detection from the text alone is guesswork. That is a constraint to design
around, not a gap to paper over.

## What TTMC does instead

It does not look for a secret Anthropic hid in the text. It reads back the
signature **we** put there.

If the sender's side runs TTMC, their message already carries a TTMC-1 stamp —
in the disclosure footer that travels with it through Slack, email, or a paste.
Identifying it is cryptography, not statistics. That is the tier allowed to
drive automation.

| Tier | Signal | Certainty | Can it trigger an automatic reply? |
|---|---|---|---|
| 1 | TTMC-1 signature, verified | **Exact** | **Yes** — the default and only bar |
| 2 | Vendor watermark | Exact | Yes, if one ever ships. Registry is empty |
| 3 | Boilerplate score | Probabilistic | **No**, unless you explicitly lower the bar |

Implementation: [`packages/core/src/detect.ts`](../packages/core/src/detect.ts).

### Verdicts

```
agent-verified   signature checked. The only thing we actually know.
agent-claimed    a stamp is present but unverified. A claim, not proof.
agent-likely     style says machine. A guess, capped at 0.65 confidence.
human-verified   signature says a person wrote it personally → never auto-answer.
forged           a stamp that fails verification. More interesting than no stamp.
unknown          nothing suggests a machine.
```

`agent-claimed` exists because finding a stamp is not checking one. The relay
holds the key, so `detectOrigin` reports the claim and `applyVerification`
resolves it — up to `agent-verified`, or down to `forged`.

## Two gates, not one

The part that matters most, and the least obvious.

Detection answers *"did a machine write this?"* It does not answer *"should a
machine answer it?"* Those are different questions, and both have to say yes.

So the inbound message also runs through the escalation gate, and these subjects
are never auto-answered no matter how confidently a machine is detected:

- anything contractual
- interpersonal conflict
- credentials
- money beyond your ceiling
- **anything you personally fenced off in your persona**

That last one belongs there because a fence you wrote ("always ask me about the
reorg") describes a *subject*, not a direction. It should stop an inbound
message being answered on your behalf as firmly as it stops your agent sending
something.

In practice it is also the one that fires most, because the sender's own gate
already refuses to emit the other four — a TTMC agent cannot write to you about
a contract in the first place.

## The policy is off, empty, and strict

```ts
{
  enabled: false,                            // opt in, deliberately
  minVerdict: "agent-verified",              // proof, not style
  allowChannels: [],                         // fails closed
  neverAutoAnswer: [],
  requireApprovalForNewCounterparts: true,   // ask once per person
}
```

A tool that starts answering your colleagues the moment it is installed would be
indefensible. Every one of these defaults is chosen so that nothing happens
until somebody decides it should.

## Try it

```bash
SLACK_SIGNING_SECRET=demo-slack-signing-secret \
TTMC_AUTOROUTE=1 TTMC_AUTOROUTE_CHANNELS=C_ENG pnpm dev   # one terminal

pnpm demo:slack                                            # another
```

Five signed Slack events, five outcomes:

| # | Message | Outcome |
|---|---|---|
| 1 | Bad request signature | `401` before the payload is parsed |
| 2 | A colleague, writing personally | ignored |
| 3 | Obvious slop, unsigned | flagged, **not** answered — style is not provenance |
| 4 | Their Claude, signed | **auto-answered** |
| 5 | Their Claude, signed, but about your fenced subject | flagged, not answered |

One of five gets answered automatically. That ratio is the design working.

## Real Slack setup

1. Create a Slack app, enable **Event Subscriptions**, subscribe to
   `message.channels` (and `message.im` for DMs).
2. Point the request URL at `https://your-host/api/v1/slack/events`.
3. Set `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN`.
4. Set `TTMC_AUTOROUTE_CHANNELS` to the channels you want covered, and
   `TTMC_AUTOROUTE=1` when you actually want it answering.

Request signatures are verified over the raw body before anything is parsed —
without that, anyone who learns the URL can make your agent speak.

## Known gaps

- **Slack identity is not linked to a TTMC account yet.** The route uses the
  session identity, which works for a single-user deployment and not for a real
  workspace. Proper OAuth install and `team_id` → account mapping is next.
- **The reply is queued, not pushed.** Your Claude collects it over MCP via
  `ttmc_inbox`. A push notification would make it feel instant.
- **Auto-route policy is environment-driven**, not editable in the UI.
- **Dedupe is in-process.** Fine for one instance; needs shared storage behind a
  load balancer, or Slack's retries will double-answer.
