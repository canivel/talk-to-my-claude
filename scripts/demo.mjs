#!/usr/bin/env node
/**
 * End-to-end demo, driven against a real running relay.
 *
 * Doubles as a smoke test: every step asserts, and the script exits non-zero
 * the moment reality stops matching the story. That is deliberate — a demo
 * that can drift out of sync with the product is worse than no demo, because
 * it keeps looking convincing after it stops being true.
 *
 *   pnpm dev          # in one terminal
 *   pnpm demo         # in another
 *
 * No API keys anywhere. The "agent" here is this script standing in for your
 * Claude, posting exactly what the MCP server would post.
 *
 * With TTMC_DEMO_JSON=1 it emits one JSON event per line instead of pretty
 * output, so `record.mjs` can group the run into scenes. Seven steps rather
 * than eleven because the recording is watched, not read: each scene has to
 * carry one idea and fit on screen.
 */

const BASE = (process.env.TTMC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const JSON_MODE = process.env.TTMC_DEMO_JSON === "1";
const SLOW = process.env.TTMC_DEMO_SLOW !== "0" && !JSON_MODE;

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  bold: "\x1b[1m",
  amber: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  white: "\x1b[97m",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, SLOW ? ms : 0));

let step = 0;

function emit(event) {
  if (JSON_MODE) {
    console.log(JSON.stringify(event));
    return;
  }
  if (event.type === "scene") {
    console.log(`\n${C.amber}${C.bold}${String(event.n).padStart(2, "0")} ${event.title}${C.reset}`);
  } else {
    console.log(`   ${event.text}${C.reset}`);
  }
}

async function scene(title) {
  step++;
  await sleep(420);
  emit({ type: "scene", n: step, title });
  await sleep(240);
}

async function say(text) {
  emit({ type: "line", text });
  await sleep(190);
}

function fail(msg) {
  if (JSON_MODE) console.log(JSON.stringify({ type: "fail", text: msg }));
  else console.log(`\n${C.red}${C.bold}FAILED${C.reset} ${msg}`);
  process.exit(1);
}

const expect = (cond, msg) => {
  if (!cond) fail(msg);
};

let token = null;

async function api(method, path, body) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

/** Session-authenticated call — no bearer, so the relay sees a human. */
async function asHuman(method, path, body) {
  const saved = token;
  token = null;
  const r = await api(method, path, body);
  token = saved;
  return r;
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/api/v1/me`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`No relay at ${BASE}. Start one with \`pnpm dev\`.`);
}

async function main() {
  await waitForServer();

  // ── 1 ───────────────────────────────────────────────────────────────────
  await scene("Set up who my agent speaks for");
  const mint = await asHuman("POST", "/api/v1/tokens", { label: "demo" });
  expect(mint.status === 201, `token mint failed: ${mint.status}`);
  token = mint.body.token;

  const persona = await asHuman("PUT", "/api/v1/persona", {
    role: "Director of AI Engineering",
    tone: "Direct and brief. No corporate register.",
    positions: [
      "Postgres is decided; do not reopen the database question.",
      "My team owns ingestion, not the dashboards.",
    ],
    boundaries: ["Never agree to weekend work."],
    authority: {
      canCommitTime: true,
      canCommitMoneyUsd: 25000,
      canCommitScope: false,
      canSpeakExternally: true,
    },
  });
  expect(persona.status === 200, `persona save failed: ${persona.status}`);
  await say(`${C.green}persona v${persona.body.persona.version}${C.reset}  2 standing positions`);
  await say(`${C.dim}may commit up to${C.reset} ${C.white}$25,000${C.reset}${C.dim}, and no scope${C.reset}`);
  await say(`${C.dim}no inference key involved — my own Claude does the thinking${C.reset}`);

  // ── 2 ───────────────────────────────────────────────────────────────────
  await scene("Someone sends me this");
  const inbound =
    "Hi there! I hope this email finds you well. Circling back on the migration " +
    "window. It's important to note that this is not just a scheduling question, " +
    "it's a strategic alignment opportunity. As we navigate this evolving " +
    "landscape, we should leverage a holistic approach that empowers the team to " +
    "deliver robust, scalable, and maintainable outcomes. Could we target Friday " +
    "afternoon? Let me know if you have any questions. Happy to discuss further!";

  const slop = await api("POST", "/api/v1/slop", { text: inbound });
  expect(slop.status === 200, "slop scoring failed");
  const s = slop.body;
  await say(`${C.dim}"I hope this email finds you well. Circling back on the${C.reset}`);
  await say(`${C.dim} migration window. It's not just a scheduling question…"${C.reset}`);
  await say(`${C.red}${C.bold}${s.score}/100${C.reset} boilerplate ${C.dim}·${C.reset} ${Math.round(s.compressionOpportunity * 100)}% of it says nothing`);
  await say(`${C.dim}tells: ${s.signals.slice(0, 3).map((x) => x.label.toLowerCase()).join(", ")}${C.reset}`);

  // ── 3 ───────────────────────────────────────────────────────────────────
  await scene("My Claude answers, and the relay signs it");
  const opened = await api("POST", "/api/v1/duels", {
    subject: "Migration window",
    counterpartName: "Raj",
    inboundMessage: inbound,
    visibility: "unlisted",
  });
  expect(opened.status === 201, `open failed: ${opened.status}`);
  const code = opened.body.duel.code;

  const reply =
    "Friday doesn't work — the board demo runs Friday at 2pm and nobody is " +
    "around to roll back. Monday morning, or Wednesday if you need the numbers sooner.";
  const turn = await api("POST", `/api/v1/duels/${code}/turns`, {
    content: reply,
    model: "claude-opus-5",
    confidence: 0.9,
  });
  expect(turn.status === 200 && turn.body.delivered, "clean turn should have been delivered");
  const footer = turn.body.disclosedText.split("\n").filter(Boolean).pop();
  const stampId = footer.match(/\/v\/(\S+)/)?.[1];

  await say(`${C.dim}"Friday doesn't work — the board demo runs Friday at 2pm.${C.reset}`);
  await say(`${C.dim} Monday morning, or Wednesday if you need numbers sooner."${C.reset}`);
  await say(`${C.green}${turn.body.turn.wordCount} words out${C.reset}${C.dim}, answering ${s.wordCount} in — and it disagrees${C.reset}`);
  await say(`${C.cyan}🤖 Danilo's Claude wrote this · not reviewed by a human${C.reset}`);

  // ── 4 ───────────────────────────────────────────────────────────────────
  await scene("Anyone can check that signature — no account needed");
  const good = await api("POST", "/api/v1/verify", { stampId, content: reply });
  expect(good.body.valid === true, "signature should verify");
  await say(`${C.green}${C.bold}valid${C.reset}    ${C.dim}written by an agent · ${good.body.claim.model} · persona v${good.body.claim.persona.version}${C.reset}`);

  const tampered = await api("POST", "/api/v1/verify", {
    stampId,
    content: "Friday works great, go ahead.",
  });
  expect(tampered.body.valid === false, "tampered text must not verify");
  await say(`${C.red}${C.bold}invalid${C.reset}  ${C.dim}after editing a single sentence → ${tampered.body.failure}${C.reset}`);
  await say(`${C.dim}the forgery that matters is "a human wrote this" — only${C.reset}`);
  await say(`${C.dim}the relay holds the key, so nobody can claim it${C.reset}`);

  // ── 5 ───────────────────────────────────────────────────────────────────
  await scene("They reply — I'm the transport, they've never heard of us");
  const relayed = await api("POST", `/api/v1/duels/${code}/inbound`, {
    content:
      "Understood on Friday. That said, we'd need to accelerate. Can your team " +
      "also take the dashboard rollup, and approve the 90,000 dollars renewal this week?",
  });
  expect(relayed.status === 200, `relay failed: ${relayed.body?.error ?? relayed.status}`);
  await say(`${C.dim}"Can your team also take the dashboard rollup, and approve${C.reset}`);
  await say(`${C.dim} the 90,000 dollars renewal this week?"${C.reset}`);
  await say(`${C.green}pasted into their seat${C.reset}${C.dim} — unsigned, because I only know I pasted it${C.reset}`);

  // ── 6 ───────────────────────────────────────────────────────────────────
  await scene("My agent overreaches. Twice.");
  const overreach = await api("POST", `/api/v1/duels/${code}/turns`, {
    content: "Agreed, we'll approve the 90,000 dollars renewal and sign the MSA this week.",
  });
  expect(overreach.body.delivered === false, "over-ceiling turn must be held");
  await say(`${C.red}${C.bold}HELD${C.reset}  ${overreach.body.escalations.map((e) => e.trigger).join(", ")}`);
  await say(`${C.dim}$90,000 is over my $25,000 ceiling — never written, never sent${C.reset}`);

  const raise = await api("PUT", "/api/v1/persona", {
    authority: { canCommitMoneyUsd: 999999 },
  });
  expect(raise.status === 403, `privilege escalation must be refused, got ${raise.status}`);
  const selfClear = await api(
    "POST",
    `/api/v1/duels/${code}/escalations/${overreach.body.escalations[0].id}/resolve`,
  );
  expect(selfClear.status === 403, "agent must not resolve its own escalation");
  await say(`${C.red}${C.bold}403${C.reset}   ${C.dim}it can't raise its own ceiling, or clear its own block${C.reset}`);

  // ── 7 ───────────────────────────────────────────────────────────────────
  // No figures in the title: they come from the live run and shift between
  // recordings, and a heading that contradicts the body two lines below it
  // undermines the one thing this demo exists to demonstrate.
  await scene("I decide it myself. Then I read this.");
  let resolved;
  for (const e of overreach.body.escalations) {
    resolved = await asHuman("POST", `/api/v1/duels/${code}/escalations/${e.id}/resolve`);
    expect(resolved.status === 200, `human resolve failed: ${resolved.status}`);
  }
  expect(resolved.body.duel.status === "live", "should be live once all are cleared");

  const digest = await api("POST", `/api/v1/duels/${code}/digest`, {
    headline: "Migration moves to Monday. Friday is the board demo.",
    decisions: [{ text: "Migration runs Monday morning.", sourceTurns: [2] }],
    openQuestions: [{ text: "Who owns the dashboard rollup.", sourceTurns: [3] }],
    actionItems: [{ text: "Tell the platform team.", owner: "A", due: "next Friday" }],
  });
  expect(digest.status === 200, "digest failed");
  const st = digest.body.digest.stats;
  expect(
    digest.body.problems.some((p) => p.field === "actionItems.due"),
    "invented due date should have been dropped",
  );

  await say(`${C.white}${C.bold}Migration moves to Monday. Friday is the board demo.${C.reset}`);
  await say(`${C.dim}open: who owns the dashboard rollup${C.reset}`);
  await say(`${C.amber}${C.bold}${st.compressionRatio}× compression${C.reset}${C.dim} · ${st.inboundWords} words in → ${st.digestWords} out${C.reset}`);
  await say(`${C.dim}and the relay dropped the due date the agent invented${C.reset}`);

  emit({ type: "done", text: `All ${step} steps passed`, url: `${BASE}/d/${code}` });
  if (!JSON_MODE) {
    console.log(`\n${C.green}${C.bold}All ${step} steps passed.${C.reset}${C.dim} ${BASE}/d/${code}${C.reset}`);
  }
  await sleep(600);
}

main().catch((e) => fail(e.message));
