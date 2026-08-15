#!/usr/bin/env node
/**
 * The Slack use case, end to end, without a Slack workspace.
 *
 * Sends properly-signed Slack event payloads at the local relay and shows what
 * it decides. Four messages, four different outcomes — which is the whole
 * point, because "detect AI and auto-reply" is only responsible if it declines
 * most of the time.
 *
 *   pnpm dev            # one terminal
 *   pnpm demo:slack     # another
 *
 * Signature verification is real: these requests are signed exactly the way
 * Slack signs, and the relay rejects them if the signature is wrong.
 */

import { createHmac } from "node:crypto";

const BASE = (process.env.TTMC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "demo-slack-signing-secret";
const CHANNEL = process.env.TTMC_AUTOROUTE_CHANNELS?.split(",")[0]?.trim() || "C_ENG";
const JSON_MODE = process.env.TTMC_DEMO_JSON === "1";

const C = {
  reset: "\x1b[0m", dim: "\x1b[90m", bold: "\x1b[1m",
  amber: "\x1b[33m", cyan: "\x1b[36m", green: "\x1b[32m",
  red: "\x1b[31m", white: "\x1b[97m",
};

let failures = 0;

function expect(cond, msg) {
  if (!cond) {
    if (JSON_MODE) emit({ type: "fail", text: msg });
    else console.log(`   ${C.red}${C.bold}FAILED${C.reset} ${msg}`);
    failures++;
  }
}

async function slackEvent({ text, user = "U_RAJ", channel = CHANNEL, ts, badSignature = false }) {
  const body = JSON.stringify({
    type: "event_callback",
    event_id: `Ev${Math.floor(Math.random() * 1e9)}`,
    team_id: "T_DEMO",
    event: {
      type: "message",
      channel,
      user,
      text,
      ts: ts ?? `${Date.now() / 1000}`,
    },
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = badSignature
    ? "v0=0000000000000000000000000000000000000000000000000000000000000000"
    : `v0=${createHmac("sha256", SIGNING_SECRET).update(`v0:${timestamp}:${body}`, "utf8").digest("hex")}`;

  const res = await fetch(`${BASE}/api/v1/slack/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": sig,
    },
    body,
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, body: payload };
}

/** Ask the relay to sign something, so we have a genuinely stamped message. */
async function stampedMessage(token, text) {
  const opened = await fetch(`${BASE}/api/v1/duels`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ subject: "seed", inboundMessage: "seed message for stamping" }),
  }).then((r) => r.json());

  const turn = await fetch(`${BASE}/api/v1/duels/${opened.duel.code}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ content: text, model: "claude-opus-5" }),
  }).then((r) => r.json());

  if (!turn.disclosedText) {
    throw new Error(
      `could not sign the fixture — the gate held it (${(turn.escalations ?? []).map((e) => e.trigger).join(", ") || turn.error}). ` +
        "The demo needs a signable message here.",
    );
  }
  return turn.disclosedText;
}

/**
 * Same dual output as demo.mjs: pretty for a terminal, one JSON event per line
 * under TTMC_DEMO_JSON=1 so record.mjs can group the run into scenes.
 */
function emit(event) {
  if (JSON_MODE) {
    console.log(JSON.stringify(event));
  } else if (event.type === "scene") {
    console.log(`\n${C.amber}${C.bold}${String(event.n).padStart(2, "0")} ${event.title}${C.reset}`);
  } else {
    console.log(`   ${event.text}${C.reset}`);
  }
}

let step = 0;
const heading = (_n, title) => emit({ type: "scene", n: ++step, title });
const say = (text) => emit({ type: "line", text });

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/v1/slack/events`)).ok) return;
    } catch {
      /* still starting, or still compiling the route */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No relay at ${BASE}. Start one with \`pnpm dev\`.`);
}

async function main() {
  if (!JSON_MODE) {
    console.log(`${C.cyan}${C.bold}talk-to-my-claude${C.reset}${C.dim} · Slack use case · ${BASE}${C.reset}`);
    console.log(`${C.dim}channel ${CHANNEL} · auto-route ${process.env.TTMC_AUTOROUTE === "1" ? "ON" : "OFF"}${C.reset}`);
  }

  await waitForServer();
  const health = await fetch(`${BASE}/api/v1/slack/events`).then((r) => r.json());
  if (!health.configured) {
    console.log(`\n${C.red}SLACK_SIGNING_SECRET is not set on the server.${C.reset}`);
    console.log(`${C.dim}Restart it with:  SLACK_SIGNING_SECRET=${SIGNING_SECRET} TTMC_AUTOROUTE=1 TTMC_AUTOROUTE_CHANNELS=${CHANNEL} pnpm dev${C.reset}`);
    process.exit(1);
  }

  const token = await fetch(`${BASE}/api/v1/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "slack-demo" }),
  }).then((r) => r.json()).then((r) => r.token);

  // Scene 5 installs a fence on the persona. Clear it up front so a second run
  // starts from the same place as the first — a demo that only works once is
  // a demo nobody trusts.
  await fetch(`${BASE}/api/v1/persona`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ escalateOn: [] }),
  });

  // ── 1 ──────────────────────────────────────────────────────────────────
  heading("01", "An unsigned request — is it really Slack?");
  const forged = await slackEvent({ text: "hello", badSignature: true });
  expect(forged.status === 401, `expected 401, got ${forged.status}`);
  say(`${C.green}401${C.reset} ${C.dim}rejected before the payload is even parsed${C.reset}`);

  // ── 2 ──────────────────────────────────────────────────────────────────
  heading("02", "A colleague writes to you, personally");
  const human = await slackEvent({
    text: "cant do thursday, moved the migration to friday because staging was still on pg 14. ping raj if you need numbers",
  });
  expect(human.body.action === "ignore", `expected ignore, got ${human.body.action}`);
  say(`${C.green}ignored${C.reset}  ${C.dim}${human.body.reason}${C.reset}`);
  say(`${C.dim}no signature, low boilerplate — nothing says a machine wrote it${C.reset}`);

  // ── 3 ──────────────────────────────────────────────────────────────────
  heading("03", "Obvious slop, but still only a guess");
  const slop = await slackEvent({
    text:
      "Hi there! I hope this message finds you well. Circling back on the migration window. " +
      "It's important to note that this is not just a scheduling question, it's a strategic " +
      "alignment opportunity. As we navigate this evolving landscape, we should leverage a " +
      "holistic approach that empowers the team to deliver robust, scalable, and maintainable " +
      "outcomes. Let me know if you have any questions. Happy to discuss further!",
  });
  expect(slop.body.verdict === "agent-likely", `expected agent-likely, got ${slop.body.verdict}`);
  expect(slop.body.action === "notify-human", `heuristic must not auto-answer, got ${slop.body.action}`);
  say(`${C.amber}${slop.body.verdict}${C.reset}  ${C.dim}${slop.body.reason}${C.reset}`);
  say(`${C.dim}style is not provenance — the heuristic alone never triggers a reply${C.reset}`);

  // ── 4 ──────────────────────────────────────────────────────────────────
  heading("04", "Their Claude writes, and it carries a signature");
  const signed = await stampedMessage(
    token,
    "Friday doesn't work — the board demo runs Friday at 2pm and nobody is around to roll back. Monday morning works.",
  );
  const detected = await slackEvent({ text: signed });
  expect(detected.body.verdict === "agent-verified", `expected agent-verified, got ${detected.body.verdict}`);
  expect(detected.body.action === "auto-answer", `expected auto-answer, got ${detected.body.action}`);
  say(`${C.green}${C.bold}agent-verified${C.reset}  ${C.dim}TTMC-1 signature checked against the exact wording${C.reset}`);
  say(`${C.green}auto-answer${C.reset}  ${C.dim}queued for my Claude — it replies over MCP, into the thread${C.reset}`);

  // ── 5 ──────────────────────────────────────────────────────────────────
  heading("05", "Same signature, but I said to always ask me about this");
  // Signed BEFORE the fence exists, which is how it works in reality: their
  // relay applied their policy, mine applies mine. The sender's gate had no
  // opinion about my reorg; my own persona does.
  const reorg = await stampedMessage(
    token,
    "The Q3 reorg lands next month, so I'd like your ingestion roadmap before then.",
  );
  await fetch(`${BASE}/api/v1/persona`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ escalateOn: ["Anything about the Q3 reorg"] }),
  });

  const fenced = await slackEvent({ text: reorg });
  expect(fenced.body.verdict === "agent-verified", `expected agent-verified, got ${fenced.body.verdict}`);
  expect(fenced.body.action === "notify-human", `fenced subject must not auto-answer, got ${fenced.body.action}`);
  say(`${C.green}agent-verified${C.reset}${C.dim}, and still${C.reset} ${C.red}${C.bold}not answered${C.reset}`);
  say(`${C.dim}${fenced.body.reason}${C.reset}`);
  say(`${C.dim}detection says machine; my own fence says ask me — both have to agree${C.reset}`);

  if (failures > 0) {
    if (!JSON_MODE) console.log(`\n${C.red}${C.bold}${failures} check(s) failed.${C.reset}`);
    process.exit(1);
  }

  emit({ type: "done", text: `All ${step} checks passed` });
  if (!JSON_MODE) {
    console.log(
      `\n${C.green}${C.bold}All ${step} checks passed.${C.reset}${C.dim} 1 of ${step} was answered automatically.${C.reset}`,
    );
  }
}

main().catch((e) => {
  if (JSON_MODE) emit({ type: "fail", text: e.message });
  else console.log(`\n${C.red}${C.bold}FAILED${C.reset} ${e.message}`);
  process.exit(1);
});
