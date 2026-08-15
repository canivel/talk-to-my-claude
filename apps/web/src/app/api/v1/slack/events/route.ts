import {
  applyVerification,
  applyWatermark,
  checkWatermark,
  createHttpWatermarkDetector,
  decideRoute,
  detectOrigin,
  evaluateEscalation,
  verifyStamp,
  type AutoRoutePolicy,
  type WatermarkDetector,
} from "@ttmc/core";
import { SIGNING_SECRETS } from "@/env";
import { personaFor, sessionIdentity } from "@/server/auth";
import { error, handle, json } from "@/server/http";
import { openExchange } from "@/server/relay";
import {
  HAS_SLACK,
  isActionable,
  postToSlack,
  slackOrigin,
  verifySlackRequest,
  type SlackEnvelope,
} from "@/server/slack";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Slack retries an event up to three times if we are slow. Without dedupe the
 * same message opens three exchanges and answers three times.
 */
const seenEvents = new Set<string>();
function alreadyHandled(id: string | undefined): boolean {
  if (!id) return false;
  if (seenEvents.has(id)) return true;
  seenEvents.add(id);
  if (seenEvents.size > 5000) {
    for (const k of Array.from(seenEvents).slice(0, 2500)) seenEvents.delete(k);
  }
  return false;
}

/**
 * Slack ingress.
 *
 * The flow, and the order is the point:
 *
 *   verify Slack's signature  → is this really Slack?
 *   detect origin             → did a machine write it? (signature > watermark > style)
 *   verify OUR stamp          → is that claim real, or forged?
 *   run the escalation gate   → is this subject automatable at all?
 *   decide the route          → does policy allow answering without asking?
 *
 * A machine-written message about a contract is still about a contract. The
 * detector and the gate both have to agree before anything is sent.
 */
export async function POST(req: Request) {
  return handle(async () => {
    // Raw body first: the signature covers exactly these bytes.
    const raw = await req.text();

    const verified = verifySlackRequest(
      raw,
      req.headers.get("x-slack-request-timestamp"),
      req.headers.get("x-slack-signature"),
    );
    if (!verified.ok) {
      if (verified.failure === "not_configured") {
        return error("Slack is not configured. Set SLACK_SIGNING_SECRET.", 503);
      }
      // Deliberately terse: an attacker probing this should learn nothing.
      return error("Bad request signature.", 401);
    }

    let envelope: SlackEnvelope;
    try {
      envelope = JSON.parse(raw) as SlackEnvelope;
    } catch {
      return error("Malformed payload.", 400);
    }

    // Slack's one-time endpoint handshake.
    if (envelope.type === "url_verification") {
      return json({ challenge: envelope.challenge });
    }

    const event = envelope.event;
    if (!isActionable(event) || alreadyHandled(envelope.event_id)) {
      // Always 200: a non-200 makes Slack retry, and there is nothing to retry.
      return json({ ok: true, skipped: true });
    }

    // ── Tier 1-3 detection.
    let detection = detectOrigin(event.text);

    // A stamp is a claim until checked. Verifying it here is what separates
    // "they say their agent wrote this" from proof — and catches a forgery,
    // which is more interesting than either.
    if (detection.stampId) {
      const stored = await store.getStamp(detection.stampId);
      const result = stored
        ? verifyStamp(stored.stamp, detection.content, SIGNING_SECRETS)
        : { valid: false as const };
      detection = applyVerification(detection, {
        valid: result.valid,
        stamp: stored?.stamp ?? null,
      });
    }

    // Tier 2. A vendor watermark proves their model touched the text, not that
    // it wrote it, so this can raise the verdict to `machine-involved` and no
    // further. Skipped entirely when no detector is configured, which is the
    // default while Anthropic's detection API is still forthcoming.
    detection = applyWatermark(detection, await checkWatermark(detection.content, detectors()));

    const identity = await sessionIdentity();
    if (!identity) {
      // No mapping from Slack workspace to TTMC account yet — see the roadmap.
      return json({ ok: true, skipped: "no linked account" });
    }
    const persona = await personaFor(identity);

    // The gate reads the INBOUND message: some subjects stay with a human even
    // when a machine wrote them.
    const inboundEscalations = evaluateEscalation(detection.content, persona).map(
      (h) => h.trigger,
    );

    const policy = await loadPolicy(identity.userId);
    const decision = decideRoute(
      detection,
      {
        channelId: event.channel,
        senderId: event.user ?? "unknown",
        knownCounterpart: policy.allowChannels.includes(event.channel),
        inboundEscalations,
      },
      policy,
    );

    if (decision.action === "ignore") {
      return json({ ok: true, action: "ignore", reason: decision.reason });
    }

    // Both routes open an exchange — the difference is whether a human is asked
    // first. Opening it either way means the transcript, the slop score and the
    // brief are all ready the moment they say yes.
    const { summary } = await openExchange(identity, {
      subject: detection.content.slice(0, 70),
      inboundMessage: event.text,
      counterpartName: event.user ? `<@${event.user}>` : "Slack",
      visibility: "unlisted",
      origin: slackOrigin(event, envelope.team_id),
    });

    if (decision.action === "notify-human") {
      return json({
        ok: true,
        action: "notify-human",
        reason: decision.reason,
        verdict: detection.verdict,
        exchange: summary.url,
      });
    }

    // Auto-answer: the exchange is queued for the user's own Claude, which
    // picks it up over MCP (`ttmc_inbox`) and replies. TTMC never generates the
    // reply itself — it has no model and no key. The turn it posts is then
    // delivered back into this Slack thread by `postTurn`.
    await postToSlack({
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      text: `🤖 Handing this to my Claude — ${detection.verdict}. Reply will be disclosed and land in this thread.`,
    });

    return json({
      ok: true,
      action: "auto-answer",
      reason: decision.reason,
      verdict: detection.verdict,
      exchange: summary.url,
    });
  });
}

/**
 * Watermark detectors, configured rather than compiled in.
 *
 * Anthropic watermarks Claude output from 2026-08-14 (arXiv 2301.10226), but
 * only they can detect it and the API shape is not published yet. Pointing
 * WATERMARK_DETECT_URL at it is all this should ever need.
 */
function detectors(): WatermarkDetector[] {
  const url = process.env.WATERMARK_DETECT_URL;
  if (!url) return [];
  return [
    createHttpWatermarkDetector({
      url,
      vendor: process.env.WATERMARK_VENDOR ?? "anthropic",
      apiKey: process.env.WATERMARK_API_KEY,
      minChars: Number(process.env.WATERMARK_MIN_CHARS ?? 400),
    }),
  ];
}

/**
 * Per-user auto-route policy. Not yet editable in the UI, so it reads from the
 * environment and otherwise stays at the strict default — off, empty
 * allowlist, proof required.
 */
async function loadPolicy(_userId: string): Promise<AutoRoutePolicy> {
  const channels = (process.env.TTMC_AUTOROUTE_CHANNELS ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const minVerdict = (process.env.TTMC_AUTOROUTE_MIN_VERDICT ??
    "agent-verified") as AutoRoutePolicy["minVerdict"];
  return {
    enabled: process.env.TTMC_AUTOROUTE === "1" && channels.length > 0,
    minVerdict,
    allowChannels: channels,
    neverAutoAnswer: (process.env.TTMC_AUTOROUTE_NEVER ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    requireApprovalForNewCounterparts: false,
  };
}

export async function GET() {
  return json({
    configured: HAS_SLACK,
    hint: HAS_SLACK
      ? "POST Slack events here."
      : "Set SLACK_SIGNING_SECRET, then point your Slack app's Event Subscriptions at this URL.",
  });
}
