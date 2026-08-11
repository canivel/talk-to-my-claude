/**
 * Exchange state machine.
 *
 * Pure functions over an immutable `Duel`. Nothing here touches storage or the
 * network, which is what makes the interesting behaviour — turn ordering,
 * convergence, forced termination — testable without a database.
 *
 * The single most important rule encoded here: an exchange is always bounded.
 * Two agents left alone will happily produce forty courteous turns, and that
 * is strictly worse than the problem we set out to solve.
 */

import type {
  AuthorKind,
  Duel,
  Persona,
  ProvenanceStamp,
  Seat,
  SeatId,
  SeatMode,
  SlopReport,
  TerminationReason,
  Turn,
  TurnBrief,
  Visibility,
} from "./types.js";
import { newDuelCode, newDuelId, newTurnId, nowIso } from "./ids.js";
import { countWords, novelty, shingles } from "./text.js";
import { renderPersonaBrief, renderPolicyBrief } from "./persona.js";

export const DEFAULT_MAX_TURNS = 6;

/** Below this share of new material, a turn is restating rather than advancing. */
const NOVELTY_THRESHOLD = 0.35;
/** Consecutive low-novelty turns required before we call it converged. */
const NOVELTY_RUN = 2;
/** Never declare convergence before both sides have actually spoken twice. */
const MIN_TURNS_FOR_CONVERGENCE = 4;

export const OTHER: Record<SeatId, SeatId> = { A: "B", B: "A" };

function emptySeat(id: SeatId, displayName: string): Seat {
  return {
    id,
    mode: "paste",
    userId: null,
    handle: null,
    displayName,
    personaRef: null,
    model: null,
    joinedAt: null,
  };
}

export interface CreateDuelInput {
  createdBy: string;
  subject: string;
  /** Seat A is the person who started it. */
  initiator: {
    userId: string;
    handle: string | null;
    displayName: string;
    mode: SeatMode;
    personaRef?: Seat["personaRef"];
    model?: string | null;
  };
  /** Seat B, usually unclaimed — the other side has not heard of us yet. */
  counterpartName?: string;
  maxTurns?: number;
  visibility?: Visibility;
}

export function createDuel(input: CreateDuelInput): Duel {
  const now = nowIso();
  const a: Seat = {
    ...emptySeat("A", input.initiator.displayName),
    mode: input.initiator.mode,
    userId: input.initiator.userId,
    handle: input.initiator.handle,
    personaRef: input.initiator.personaRef ?? null,
    model: input.initiator.model ?? null,
    joinedAt: now,
  };
  return {
    id: newDuelId(),
    code: newDuelCode(),
    subject: input.subject.trim() || "Untitled exchange",
    status: "live",
    termination: null,
    seats: { A: a, B: emptySeat("B", input.counterpartName?.trim() || "Their side") },
    // Seat B moves first: the whole premise is that they sent you something.
    turnOf: "B",
    turns: [],
    maxTurns: Math.max(2, Math.min(20, input.maxTurns ?? DEFAULT_MAX_TURNS)),
    escalations: [],
    digest: null,
    visibility: input.visibility ?? "private",
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export function claimSeat(
  duel: Duel,
  seatId: SeatId,
  claim: {
    userId: string;
    handle: string | null;
    displayName: string;
    mode: SeatMode;
    personaRef?: Seat["personaRef"];
    model?: string | null;
  },
): Duel {
  const seat = duel.seats[seatId];
  if (seat.userId && seat.userId !== claim.userId) {
    throw new Error(`Seat ${seatId} is already claimed`);
  }
  const next: Seat = {
    ...seat,
    userId: claim.userId,
    handle: claim.handle,
    displayName: claim.displayName,
    mode: claim.mode,
    personaRef: claim.personaRef ?? seat.personaRef,
    model: claim.model ?? seat.model,
    joinedAt: seat.joinedAt ?? nowIso(),
  };
  return {
    ...duel,
    seats: { ...duel.seats, [seatId]: next },
    updatedAt: nowIso(),
  };
}

export interface PostCheck {
  ok: boolean;
  reason?: string;
}

export function canPost(duel: Duel, seat: SeatId): PostCheck {
  if (duel.status !== "live") {
    return { ok: false, reason: `This exchange is ${duel.status} and accepts no more turns.` };
  }
  if (duel.turnOf !== seat) {
    return { ok: false, reason: `It is seat ${duel.turnOf}'s turn, not seat ${seat}'s.` };
  }
  if (duel.turns.length >= duel.maxTurns) {
    return { ok: false, reason: "Turn cap reached." };
  }
  return { ok: true };
}

export interface AppendTurnInput {
  seat: SeatId;
  author: AuthorKind;
  content: string;
  provenance?: ProvenanceStamp | null;
  slop?: SlopReport | null;
  /** Skip the turn-order check. Used for the seeded opening message. */
  force?: boolean;
}

export interface AppendTurnResult {
  duel: Duel;
  turn: Turn;
  /** Set when this turn ended the exchange. */
  terminated: TerminationReason;
}

export function appendTurn(duel: Duel, input: AppendTurnInput): AppendTurnResult {
  if (!input.force) {
    const check = canPost(duel, input.seat);
    if (!check.ok) throw new Error(check.reason);
  }

  const content = input.content.trim();
  if (!content) throw new Error("A turn cannot be empty.");

  const turn: Turn = {
    id: newTurnId(),
    duelId: duel.id,
    index: duel.turns.length + 1,
    seat: input.seat,
    author: input.author,
    content,
    wordCount: countWords(content),
    provenance: input.provenance ?? null,
    slop: input.slop ?? null,
    createdAt: nowIso(),
  };

  const turns = [...duel.turns, turn];
  let next: Duel = { ...duel, turns, updatedAt: turn.createdAt };

  const termination = evaluateTermination(next);
  if (termination) {
    next = {
      ...next,
      status: termination === "escalated" ? "escalated" : "converged",
      termination,
      turnOf: null,
    };
  } else {
    next = { ...next, turnOf: OTHER[input.seat] };
  }

  return { duel: next, turn, terminated: termination };
}

/**
 * Decide whether the exchange should stop. Order matters: an open escalation
 * outranks everything, because the human is already being asked to step in.
 */
export function evaluateTermination(duel: Duel): TerminationReason {
  if (duel.escalations.some((e) => e.resolvedAt === null)) return "escalated";
  if (duel.turns.length >= duel.maxTurns) return "turn_cap";
  if (hasConverged(duel)) return "converged";
  return null;
}

/**
 * Convergence detection without a model call.
 *
 * Each turn is reduced to word trigrams and compared against everything said
 * before it. When consecutive turns stop introducing new material, the agents
 * are restating rather than progressing, and the exchange has produced all the
 * information it is going to. Cheap, deterministic, and — unlike asking a model
 * "are you done?" — it cannot be talked out of stopping.
 */
export function hasConverged(duel: Duel): boolean {
  const turns = duel.turns;
  if (turns.length < MIN_TURNS_FOR_CONVERGENCE) return false;

  const scores = noveltySeries(duel);
  const tail = scores.slice(-NOVELTY_RUN);
  return tail.length === NOVELTY_RUN && tail.every((n) => n < NOVELTY_THRESHOLD);
}

/** Per-turn novelty, aligned to `duel.turns`. First turn is always 1. */
export function noveltySeries(duel: Duel): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const [i, turn] of duel.turns.entries()) {
    const sh = shingles(turn.content);
    out.push(i === 0 ? 1 : novelty(sh, seen));
    for (const s of sh) seen.add(s);
  }
  return out;
}

export function withEscalation(duel: Duel, escalation: Duel["escalations"][number]): Duel {
  return {
    ...duel,
    escalations: [...duel.escalations, escalation],
    status: "escalated",
    termination: "escalated",
    turnOf: null,
    updatedAt: nowIso(),
  };
}

/**
 * Resolve an escalation and hand control back to the agent. The seat that was
 * blocked keeps the turn — a human unblocking you does not cost you your move.
 */
export function resolveEscalation(duel: Duel, escalationId: string, resumeSeat: SeatId): Duel {
  const escalations = duel.escalations.map((e) =>
    e.id === escalationId && e.resolvedAt === null ? { ...e, resolvedAt: nowIso() } : e,
  );
  const stillOpen = escalations.some((e) => e.resolvedAt === null);
  const capped = duel.turns.length >= duel.maxTurns;
  return {
    ...duel,
    escalations,
    status: stillOpen ? "escalated" : capped ? "converged" : "live",
    termination: stillOpen ? "escalated" : capped ? "turn_cap" : null,
    turnOf: stillOpen || capped ? null : resumeSeat,
    updatedAt: nowIso(),
  };
}

export function closeDuel(duel: Duel, reason: TerminationReason = "closed_by_owner"): Duel {
  return {
    ...duel,
    status: "closed",
    termination: reason,
    turnOf: null,
    updatedAt: nowIso(),
  };
}

export function setVisibility(duel: Duel, visibility: Visibility): Duel {
  return { ...duel, visibility, updatedAt: nowIso() };
}

export function turnsRemaining(duel: Duel): number {
  return Math.max(0, duel.maxTurns - duel.turns.length);
}

export function lastTurnFrom(duel: Duel, seat: SeatId): Turn | null {
  for (let i = duel.turns.length - 1; i >= 0; i--) {
    const t = duel.turns[i]!;
    if (t.seat === seat) return t;
  }
  return null;
}

/**
 * Assemble everything an agent needs to take its turn. This is the payload the
 * MCP server hands to a participant's own Claude.
 */
export function buildTurnBrief(duel: Duel, seat: SeatId, persona: Persona): TurnBrief {
  const opponentSeat = duel.seats[OTHER[seat]];
  const inbound = lastTurnFrom(duel, OTHER[seat]);

  return {
    duelId: duel.id,
    code: duel.code,
    subject: duel.subject,
    yourSeat: seat,
    opponent: {
      displayName: opponentSeat.displayName,
      handle: opponentSeat.handle,
      mode: opponentSeat.mode,
    },
    personaBrief: renderPersonaBrief(persona),
    policyBrief: renderPolicyBrief({
      duel,
      seat,
      turnsRemaining: turnsRemaining(duel),
      inboundWords: inbound?.wordCount ?? 120,
    }),
    transcript: duel.turns.map((t) => ({
      index: t.index,
      seat: t.seat,
      author: t.author,
      speaker: duel.seats[t.seat].displayName,
      content: t.content,
    })),
    turnsRemaining: turnsRemaining(duel),
    inboundSlop: inbound?.slop ?? null,
  };
}
