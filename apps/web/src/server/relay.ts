/**
 * The relay service layer — where @ttmc/core meets storage.
 *
 * API routes stay thin and call into here. The ordering inside `postTurn` is
 * the security-relevant part of the whole application, and it is commented
 * where it matters.
 */

import type {
  Duel,
  Escalation,
  Persona,
  SeatId,
  TurnBrief,
  Visibility,
} from "@ttmc/core";
import {
  appendTurn,
  buildDigest,
  buildTurnBrief,
  canPost,
  claimSeat,
  createDuel,
  evaluateEscalation,
  fallbackDigest,
  isBlocking,
  newEscalationId,
  nowIso,
  OTHER,
  renderDigestMarkdown,
  scoreSlop,
  signStamp,
  stampId,
  stripDisclosure,
  toEscalation,
  turnsRemaining,
  withDisclosure,
  withEscalation,
  type DigestDraft,
} from "@ttmc/core";
import { PUBLIC_URL, SIGNING_SECRET } from "@/env";
import { personaFor, type Identity } from "@/server/auth";
import { store } from "@/server/store";

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

export interface DuelSummary {
  id: string;
  code: string;
  subject: string;
  status: Duel["status"];
  yourSeat: SeatId | null;
  awaitingYou: boolean;
  counterpart: string;
  turnCount: number;
  turnsRemaining: number;
  updatedAt: string;
  url: string;
}

export function duelUrl(duel: Duel): string {
  return `${PUBLIC_URL}/d/${duel.code}`;
}

export function seatOf(duel: Duel, userId: string): SeatId | null {
  if (duel.seats.A.userId === userId) return "A";
  if (duel.seats.B.userId === userId) return "B";
  return null;
}

export function summarize(duel: Duel, userId: string): DuelSummary {
  const seat = seatOf(duel, userId);
  return {
    id: duel.id,
    code: duel.code,
    subject: duel.subject,
    status: duel.status,
    yourSeat: seat,
    awaitingYou: seat !== null && duel.turnOf === seat && duel.status === "live",
    counterpart: seat ? duel.seats[OTHER[seat]].displayName : duel.seats.B.displayName,
    turnCount: duel.turns.length,
    turnsRemaining: turnsRemaining(duel),
    updatedAt: duel.updatedAt,
    url: duelUrl(duel),
  };
}

export async function loadDuel(codeOrId: string): Promise<Duel> {
  const duel = codeOrId.startsWith("duel_")
    ? await store.getDuel(codeOrId)
    : await store.getDuelByCode(codeOrId);
  if (!duel) throw new RelayError(`No exchange found for "${codeOrId}".`, 404);
  return duel;
}

/** Loads an exchange and asserts the caller occupies a seat in it. */
async function loadSeated(
  codeOrId: string,
  identity: Identity,
): Promise<{ duel: Duel; seat: SeatId }> {
  const duel = await loadDuel(codeOrId);
  const seat = seatOf(duel, identity.userId);
  if (!seat) throw new RelayError("You do not hold a seat in this exchange.", 403);
  return { duel, seat };
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export interface OpenInput {
  subject: string;
  inboundMessage?: string;
  counterpartName?: string;
  maxTurns?: number;
  visibility?: Visibility;
}

export async function openExchange(
  identity: Identity,
  input: OpenInput,
): Promise<{ duel: Duel; summary: DuelSummary; brief: TurnBrief | null }> {
  const persona = await personaFor(identity);

  let duel = createDuel({
    createdBy: identity.userId,
    subject: input.subject,
    initiator: {
      userId: identity.userId,
      handle: identity.handle,
      displayName: identity.displayName,
      mode: "mcp",
      personaRef: { handle: persona.handle, version: persona.version },
    },
    counterpartName: input.counterpartName,
    maxTurns: input.maxTurns,
    visibility: input.visibility,
  });

  const inbound = input.inboundMessage?.trim();
  if (inbound) {
    // Seated as seat B's opening move, deliberately without a provenance stamp.
    // Someone pasted this in; we know that and nothing else about who wrote it,
    // and signing a claim we cannot support would undermine every stamp we do
    // issue. The slop score is offered instead, clearly labelled as a guess.
    const content = stripDisclosure(inbound);
    duel = appendTurn(duel, {
      seat: "B",
      author: "unattributed",
      content,
      slop: scoreSlop(content),
    }).duel;
  } else {
    duel = { ...duel, turnOf: "A" };
  }

  await store.saveDuel(duel);

  return {
    duel,
    summary: summarize(duel, identity.userId),
    brief: duel.turnOf === "A" ? buildTurnBrief(duel, "A", persona) : null,
  };
}

export async function joinExchange(
  identity: Identity,
  codeOrId: string,
  mode: "mcp" | "byok" | "human" = "mcp",
): Promise<{ duel: Duel; summary: DuelSummary; brief: TurnBrief | null }> {
  let duel = await loadDuel(codeOrId);
  const persona = await personaFor(identity);

  let seat = seatOf(duel, identity.userId);
  if (!seat) {
    const open = (["B", "A"] as const).find((s) => duel.seats[s].userId === null);
    if (!open) throw new RelayError("Both seats in this exchange are taken.", 409);
    seat = open;
    duel = claimSeat(duel, seat, {
      userId: identity.userId,
      handle: identity.handle,
      displayName: identity.displayName,
      mode,
      personaRef: { handle: persona.handle, version: persona.version },
    });
    await store.saveDuel(duel);
  }

  return {
    duel,
    summary: summarize(duel, identity.userId),
    brief: duel.turnOf === seat ? buildTurnBrief(duel, seat, persona) : null,
  };
}

export async function getBrief(identity: Identity, codeOrId: string): Promise<TurnBrief> {
  const { duel, seat } = await loadSeated(codeOrId, identity);
  const persona = await personaFor(identity);
  return buildTurnBrief(duel, seat, persona);
}

// ─── Turns ──────────────────────────────────────────────────────────────────

export interface PostTurnInput {
  content: string;
  model?: string;
  humanReviewed?: boolean;
  confidence?: number;
  /**
   * Who wrote these words. `human` is only legitimate when the seat holder
   * typed them personally — the web reply box offers it as an explicit choice.
   */
  author?: "agent" | "human";
}

export interface PostTurnResult {
  duel: Duel;
  summary: DuelSummary;
  delivered: boolean;
  escalations: Escalation[];
  turn: { index: number; wordCount: number } | null;
  disclosedText: string | null;
  url: string;
}

export async function postTurn(
  identity: Identity,
  codeOrId: string,
  input: PostTurnInput,
): Promise<PostTurnResult> {
  const { duel, seat } = await loadSeated(codeOrId, identity);

  const check = canPost(duel, seat);
  if (!check.ok) throw new RelayError(check.reason!, 409);

  const persona = await personaFor(identity);

  // Strip any disclosure the caller included, so the signature covers the
  // author's actual words rather than a footer from a previous hop.
  const content = stripDisclosure(input.content).trim();
  if (!content) throw new RelayError("A turn cannot be empty.", 400);

  const author = input.author ?? "agent";

  // ── The gate runs BEFORE anything is signed or appended. A turn that trips
  //    it is never written to the transcript, so a blocked commitment leaves no
  //    artifact that could later be mistaken for one that was delivered.
  const allHits = evaluateEscalation(content, persona, {
    confidence: input.confidence,
    counterpartIsExternal: isExternal(duel, seat),
  });

  // Authority ceilings constrain agents, not people. A human who chooses to
  // commit their own money on their own behalf is exercising authority, not
  // exceeding it — so for human-authored turns only the hard fences apply,
  // and those are about the text itself rather than about permission.
  const hits = author === "human" ? allHits.filter(isBlocking) : allHits;

  if (hits.length > 0) {
    const now = nowIso();
    let next = duel;
    const raised: Escalation[] = [];
    for (const hit of hits) {
      const esc = toEscalation(hit, {
        id: newEscalationId(),
        duelId: duel.id,
        seat,
        now,
      });
      raised.push(esc);
      next = withEscalation(next, esc);
    }
    await store.saveDuel(next);
    return {
      duel: next,
      summary: summarize(next, identity.userId),
      delivered: false,
      escalations: raised,
      turn: null,
      // Blocking hits mean the text itself is the hazard (a live credential),
      // so it is not echoed back even to its own author.
      disclosedText: null,
      url: duelUrl(next),
    };
  }

  const stamp = signStamp(
    {
      v: 1,
      duelId: duel.id,
      turnIndex: duel.turns.length + 1,
      seat,
      author,
      model: author === "human" ? null : input.model ?? duel.seats[seat].model ?? null,
      persona: author === "human" ? null : { handle: persona.handle, version: persona.version },
      // Only ever true when a human genuinely approved this exact text. The
      // MCP tool description makes the same point to the agent.
      humanReviewed: author === "human" || input.humanReviewed === true,
      ts: nowIso(),
      content,
    },
    SIGNING_SECRET,
  );

  const { duel: next, turn } = appendTurn(duel, {
    seat,
    author,
    content,
    provenance: stamp,
    slop: scoreSlop(content),
  });

  await store.saveDuel(next);
  await store.saveStamp({
    id: stampId(stamp),
    duelId: duel.id,
    turnIndex: turn.index,
    stamp,
  });

  return {
    duel: next,
    summary: summarize(next, identity.userId),
    delivered: true,
    escalations: [],
    turn: { index: turn.index, wordCount: turn.wordCount },
    disclosedText: withDisclosure(content, stamp, {
      displayName: identity.displayName,
      publicUrl: PUBLIC_URL,
    }),
    url: duelUrl(next),
  };
}

/**
 * Whether the counterpart is known to be outside the seat holder's organization.
 *
 * Returns false until org membership actually exists, which lands with the
 * enterprise tier. An earlier version treated an unclaimed seat as external on
 * the theory that it was the conservative reading — but an unclaimed seat is
 * the *primary* case (the person who messaged you has never heard of TTMC), so
 * every first turn escalated and the product refused its own core function.
 * Unknown is not the same as external, and a fence that blocks everything
 * protects nothing.
 */
function isExternal(_duel: Duel, _seat: SeatId): boolean {
  return false;
}

export async function escalateExchange(
  identity: Identity,
  codeOrId: string,
  reason: string,
): Promise<{ duel: Duel; escalation: Escalation; url: string }> {
  const { duel, seat } = await loadSeated(codeOrId, identity);
  const escalation: Escalation = {
    id: newEscalationId(),
    duelId: duel.id,
    seat,
    trigger: "explicit_request",
    reason: reason.trim() || "Your agent asked you to step in.",
    evidence: [],
    raisedAt: nowIso(),
    resolvedAt: null,
  };
  const next = withEscalation(duel, escalation);
  await store.saveDuel(next);
  return { duel: next, escalation, url: duelUrl(next) };
}

// ─── Digest ─────────────────────────────────────────────────────────────────

export async function submitDigest(
  identity: Identity,
  codeOrId: string,
  draft: DigestDraft,
): Promise<{
  duel: Duel;
  markdown: string;
  problems: Array<{ field: string; message: string }>;
  url: string;
}> {
  const { duel, seat } = await loadSeated(codeOrId, identity);
  const { digest, problems } = buildDigest(duel, draft, seat);
  const next: Duel = { ...duel, digest, updatedAt: nowIso() };
  await store.saveDuel(next);
  return {
    duel: next,
    markdown: renderDigestMarkdown(digest, next),
    problems,
    url: duelUrl(next),
  };
}

/** The digest shown on the public page, synthesised if nobody produced one. */
export function digestFor(duel: Duel) {
  return duel.digest ?? (duel.status !== "live" ? fallbackDigest(duel) : null);
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function listExchanges(
  identity: Identity,
  opts: { awaitingMe?: boolean } = {},
): Promise<DuelSummary[]> {
  const duels = await store.listDuelsForUser(identity.userId);
  const summaries = duels.map((d) => summarize(d, identity.userId));
  return opts.awaitingMe ? summaries.filter((s) => s.awaitingYou) : summaries;
}

export async function personaOf(identity: Identity): Promise<Persona> {
  return personaFor(identity);
}

export { isBlocking };
