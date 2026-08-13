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
 */

const BASE = (process.env.TTMC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SLOW = process.env.TTMC_DEMO_SLOW !== "0";

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
async function heading(text) {
  step++;
  await sleep(420);
  console.log(`\n${C.amber}${C.bold}${String(step).padStart(2, "0")} ${text}${C.reset}`);
  await sleep(240);
}

async function say(text) {
  console.log(`   ${text}${C.reset}`);
  await sleep(190);
}

function fail(msg) {
  console.log(`\n${C.red}${C.bold}FAILED${C.reset} ${msg}`);
  process.exit(1);
}

function expect(cond, msg) {
  if (!cond) fail(msg);
}

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
      const r = await fetch(`${BASE}/api/v1/me`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`No relay at ${BASE}. Start one with \`pnpm dev\`.`);
}

async function main() {
  console.log(
    `${C.cyan}${C.bold}talk-to-my-claude${C.reset}${C.dim} · end-to-end demo · ${BASE}${C.reset}`,
  );
  console.log(`${C.dim}no inference key is used anywhere in this run${C.reset}`);

  await waitForServer();

  // ── 1 ───────────────────────────────────────────────────────────────────
  await heading("Mint an agent token");
  const mint = await asHuman("POST", "/api/v1/tokens", { label: "demo" });
  expect(mint.status === 201, `expected 201, got ${mint.status}`);
  token = mint.body.token;
  await say(`${C.green}ok${C.reset}  ${C.dim}${token.slice(0, 18)}…${C.reset}`);

  // ── 2 ───────────────────────────────────────────────────────────────────
  await heading("Write the persona my agent speaks from");
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
  await say(`${C.green}ok${C.reset}  v${persona.body.persona.version} · 2 positions · ceiling ${C.white}$25,000${C.reset}`);

  // ── 3 ───────────────────────────────────────────────────────────────────
  await heading("Someone sends me this");
  const inbound =
    "Hi there! I hope this email finds you well. Circling back on the migration " +
    "window. It's important to note that this is not just a scheduling question, " +
    "it's a strategic alignment opportunity. As we navigate this evolving " +
    "landscape, we should leverage a holistic approach that empowers the team to " +
    "deliver robust, scalable, and maintainable outcomes. Could we target Friday " +
    "afternoon? Let me know if you have any questions. Happy to discuss further!";

  await say(`${C.dim}"${inbound.slice(0, 62)}…"${C.reset}`);
  const slop = await api("POST", "/api/v1/slop", { text: inbound });
  expect(slop.status === 200, "slop scoring failed");
  const s = slop.body;
  await say(
    `${C.red}${s.score}/100${C.reset} ${s.band} ${C.dim}·${C.reset} ` +
      `${Math.round(s.compressionOpportunity * 100)}% of it carries no information`,
  );
  await say(`${C.dim}tells: ${s.signals.slice(0, 3).map((x) => x.label.toLowerCase()).join(", ")}${C.reset}`);

  // ── 4 ───────────────────────────────────────────────────────────────────
  await heading("Hand it to my Claude");
  const opened = await api("POST", "/api/v1/duels", {
    subject: "Migration window",
    counterpartName: "Raj",
    inboundMessage: inbound,
    visibility: "unlisted",
  });
  expect(opened.status === 201, `open failed: ${opened.status}`);
  const code = opened.body.duel.code;
  await say(`${C.green}ok${C.reset}  exchange ${C.cyan}${code}${C.reset} ${C.dim}· their turn stored UNSIGNED — we don't know who wrote it${C.reset}`);

  // ── 5 ───────────────────────────────────────────────────────────────────
  await heading("My agent answers, and the relay signs it");
  const reply =
    "Friday doesn't work — the board demo runs Friday at 2pm and nobody is " +
    "around to roll back. Monday morning, or Wednesday if you need the numbers sooner.";
  const turn = await api("POST", `/api/v1/duels/${code}/turns`, {
    content: reply,
    model: "claude-opus-5",
    confidence: 0.9,
  });
  expect(turn.status === 200 && turn.body.delivered, "clean turn should have been delivered");
  await say(`${C.green}delivered${C.reset}  ${turn.body.turn.wordCount} words ${C.dim}(they sent ${s.wordCount})${C.reset}`);
  const footer = turn.body.disclosedText.split("\n").filter(Boolean).pop();
  await say(`${C.cyan}${footer}${C.reset}`);

  // ── 6 ───────────────────────────────────────────────────────────────────
  await heading("Anyone can check that signature — no account needed");
  const stampId = footer.match(/\/v\/(\S+)/)?.[1];
  const good = await api("POST", "/api/v1/verify", { stampId, content: reply });
  expect(good.body.valid === true, "signature should verify");
  await say(`${C.green}valid${C.reset}    written by ${good.body.claim.author} ${C.dim}· ${good.body.claim.model} · persona ${good.body.claim.persona.handle}@${good.body.claim.persona.version}${C.reset}`);

  const tampered = await api("POST", "/api/v1/verify", {
    stampId,
    content: "Friday works great, go ahead.",
  });
  expect(tampered.body.valid === false, "tampered text must not verify");
  await say(`${C.red}invalid${C.reset}  ${C.dim}after editing one sentence → ${tampered.body.failure}${C.reset}`);

  // ── 7 ───────────────────────────────────────────────────────────────────
  await heading("They reply. I'm the transport — they've never heard of us");
  const secondInbound =
    "Understood on Friday. That said, we'd need to accelerate the timeline to " +
    "capture the strategic value here. Can your team also take on the dashboard " +
    "rollup, and are you able to approve the 90,000 dollars vendor renewal this week?";
  const relayed = await api("POST", `/api/v1/duels/${code}/inbound`, {
    content: secondInbound,
  });
  expect(relayed.status === 200, `relay failed: ${relayed.body?.error ?? relayed.status}`);
  await say(`${C.green}ok${C.reset}  pasted into their seat ${C.dim}· unsigned, scored, my turn again${C.reset}`);

  // ── 8 ───────────────────────────────────────────────────────────────────
  await heading("Now my agent tries to promise something it may not");
  const overreach = await api("POST", `/api/v1/duels/${code}/turns`, {
    content: "Agreed, we'll approve the 90,000 dollars renewal and sign the MSA this week.",
  });
  expect(overreach.body.delivered === false, "over-ceiling turn must be held");
  await say(`${C.red}HELD${C.reset}     ${C.dim}never written to the transcript, nothing sent${C.reset}`);
  for (const e of overreach.body.escalations.slice(0, 3)) {
    await say(`${C.dim}  ↳ ${e.trigger}${C.reset}`);
  }

  // ── 9 ───────────────────────────────────────────────────────────────────
  await heading("So it tries to raise its own ceiling instead");
  const escalate = await api("PUT", "/api/v1/persona", {
    authority: { canCommitMoneyUsd: 999999 },
  });
  expect(escalate.status === 403, `privilege escalation must be refused, got ${escalate.status}`);
  await say(`${C.red}403${C.reset}      ${C.dim}an agent doesn't get to widen the limits it's checked against${C.reset}`);

  const selfResolve = await api(
    "POST",
    `/api/v1/duels/${code}/escalations/${overreach.body.escalations[0].id}/resolve`,
  );
  expect(selfResolve.status === 403, "agent must not resolve its own escalation");
  await say(`${C.red}403${C.reset}      ${C.dim}nor clear the escalation it just tripped${C.reset}`);

  // ── 10 ──────────────────────────────────────────────────────────────────
  await heading("I look at it myself and hand the turn back");
  // The turn tripped more than one fence, and the exchange stays halted until
  // every one of them has been looked at. That is the point of them.
  let resolved;
  for (const e of overreach.body.escalations) {
    resolved = await asHuman("POST", `/api/v1/duels/${code}/escalations/${e.id}/resolve`);
    expect(resolved.status === 200, `human resolve failed: ${resolved.status}`);
  }
  expect(resolved.body.duel.status === "live", "should be live once all are cleared");
  await say(
    `${C.green}resumed${C.reset}  ${overreach.body.escalations.length} cleared → status ${resolved.body.duel.status} ${C.dim}· my turn again${C.reset}`,
  );

  // ── 11 ──────────────────────────────────────────────────────────────────
  await heading("The only part a human actually reads");
  const digest = await api("POST", `/api/v1/duels/${code}/digest`, {
    headline: "Migration moves to Monday. Friday is the board demo.",
    decisions: [{ text: "Migration runs Monday morning.", sourceTurns: [2] }],
    openQuestions: [{ text: "Whether Raj needs numbers before Wednesday.", sourceTurns: [2] }],
    actionItems: [{ text: "Tell the platform team.", owner: "A", due: "next Friday" }],
  });
  expect(digest.status === 200, "digest failed");
  const st = digest.body.digest.stats;
  await say(`${C.white}${digest.body.digest.headline}${C.reset}`);
  await say(
    `${C.amber}${C.bold}${st.compressionRatio}×${C.reset} compression ${C.dim}· ${st.inboundWords} words in → ${st.digestWords} out${C.reset}`,
  );
  expect(
    digest.body.problems.some((p) => p.field === "actionItems.due"),
    "invented due date should have been dropped",
  );
  await say(`${C.dim}relay dropped the due date the agent invented ("next Friday")${C.reset}`);

  await sleep(500);
  console.log(`\n${C.green}${C.bold}All 11 steps passed.${C.reset}${C.dim} ${BASE}/d/${code}${C.reset}`);
  await sleep(1400);
}

main().catch((e) => fail(e.message));
