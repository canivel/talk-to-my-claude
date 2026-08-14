/**
 * Slack adapter.
 *
 * Ingress is the interesting half: Slack signs every request, and verifying
 * that signature is the only thing standing between "my agent answers my
 * colleagues" and "anyone on the internet can make my agent say things". It is
 * checked before the payload is parsed, let alone acted on.
 *
 * Egress is a single `chat.postMessage` call. With no bot token configured it
 * degrades to logging what it *would* have sent, which is what makes the local
 * demo runnable without a Slack workspace.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";
export const HAS_SLACK = SLACK_SIGNING_SECRET.length > 0;

/** Slack's replay window. Older requests are rejected outright. */
const MAX_SKEW_SECONDS = 60 * 5;

export type SlackVerifyFailure =
  | "not_configured"
  | "missing_headers"
  | "stale_timestamp"
  | "bad_signature";

export interface SlackVerifyResult {
  ok: boolean;
  failure?: SlackVerifyFailure;
}

/**
 * Verify `X-Slack-Signature` over the RAW body.
 *
 * The raw bytes matter: re-serializing parsed JSON changes key order and
 * whitespace, and the signature is over exactly what Slack sent. Any route
 * using this must read `await req.text()` first and parse afterwards.
 */
export function verifySlackRequest(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  opts: { signingSecret?: string; now?: number } = {},
): SlackVerifyResult {
  const secret = opts.signingSecret ?? SLACK_SIGNING_SECRET;
  if (!secret) return { ok: false, failure: "not_configured" };
  if (!timestamp || !signature) return { ok: false, failure: "missing_headers" };

  const ts = Number(timestamp);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, failure: "stale_timestamp" };
  }

  const expected = `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`, "utf8")
    .digest("hex")}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, failure: "bad_signature" };
  }
  return { ok: true };
}

/** Helper for tests and the local demo: sign a body the way Slack would. */
export function signSlackRequest(
  rawBody: string,
  timestamp: string,
  signingSecret: string,
): string {
  return `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`, "utf8")
    .digest("hex")}`;
}

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  channel: string;
  user?: string;
  bot_id?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel_type?: string;
}

export interface SlackEnvelope {
  type: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: SlackMessageEvent;
}

/**
 * Messages we must never act on. Answering our own disclosure footer would
 * loop two agents into each other forever inside a single Slack thread, which
 * is a spectacular version of the exact problem this product exists to stop.
 */
export function isActionable(event: SlackMessageEvent | undefined): event is SlackMessageEvent {
  if (!event || event.type !== "message") return false;
  if (event.bot_id) return false;
  // Edits, deletions, joins, thread broadcasts — all carry a subtype.
  if (event.subtype) return false;
  if (!event.text?.trim()) return false;
  return true;
}

export interface PostResult {
  delivered: boolean;
  /** True when there is no bot token and we only logged the message. */
  simulated: boolean;
  error?: string;
}

export async function postToSlack(args: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<PostResult> {
  if (!SLACK_BOT_TOKEN) {
    console.log(
      `[slack:simulated] → ${args.channel}${args.threadTs ? ` (thread ${args.threadTs})` : ""}\n${args.text}\n`,
    );
    return { delivered: false, simulated: true };
  }

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: args.channel,
        text: args.text,
        thread_ts: args.threadTs,
        // Never let a relayed message ping a channel. The reply is a reply,
        // not an announcement.
        unfurl_links: false,
        link_names: false,
      }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    return body.ok
      ? { delivered: true, simulated: false }
      : { delivered: false, simulated: false, error: body.error };
  } catch (err) {
    return { delivered: false, simulated: false, error: (err as Error).message };
  }
}

/** Slack thread coordinates, stored on the exchange so replies go home. */
export function slackOrigin(event: SlackMessageEvent, teamId?: string) {
  return {
    adapter: "slack" as const,
    ref: {
      channel: event.channel,
      // Reply in-thread when there is one; otherwise start a thread on the
      // message itself rather than talking over the channel.
      threadTs: event.thread_ts ?? event.ts,
      ...(event.user ? { user: event.user } : {}),
      ...(teamId ? { team: teamId } : {}),
    },
  };
}
