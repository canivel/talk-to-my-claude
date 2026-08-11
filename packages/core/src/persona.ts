/**
 * Personas and the instructions handed to a seat's agent.
 *
 * The briefs below are the actual product. An agent with no persona produces
 * exactly the confident, empty text this whole project exists to complain
 * about, so the persona is what turns "an AI replied" into "my position was
 * represented". Treat edits here as product changes, not copy tweaks.
 */

import type { Duel, Persona, SeatId } from "./types.js";
import { nowIso } from "./ids.js";
import { countWords } from "./text.js";

export function createPersona(input: {
  handle: string;
  displayName: string;
  role?: string;
  tone?: string;
  positions?: string[];
  boundaries?: string[];
  escalateOn?: string[];
  authority?: Partial<Persona["authority"]>;
}): Persona {
  return {
    handle: input.handle,
    displayName: input.displayName,
    role: input.role ?? "",
    tone: input.tone ?? "Direct and brief. Plain words. No corporate register.",
    positions: input.positions ?? [],
    boundaries: input.boundaries ?? [],
    escalateOn: input.escalateOn ?? [],
    // Defaults are the most restrictive thing that is still useful: a new agent
    // can explain and disagree, but cannot promise anything.
    //
    // `canSpeakExternally` is the deliberate exception. Answering someone who
    // messaged you is the entire product, and defaulting it off meant a fresh
    // persona escalated on its very first turn. What an agent may *agree to*
    // stays at zero; whether it may reply at all is not the useful fence.
    authority: {
      canCommitTime: false,
      canCommitMoneyUsd: 0,
      canCommitScope: false,
      canSpeakExternally: true,
      ...input.authority,
    },
    version: 1,
    updatedAt: nowIso(),
  };
}

/** Any edit bumps the version, because disclosure stamps cite it. */
export function revisePersona(persona: Persona, patch: Partial<Persona>): Persona {
  return {
    ...persona,
    ...patch,
    authority: { ...persona.authority, ...(patch.authority ?? {}) },
    version: persona.version + 1,
    updatedAt: nowIso(),
  };
}

export interface PersonaProblem {
  field: string;
  message: string;
}

export function validatePersona(p: Persona): PersonaProblem[] {
  const problems: PersonaProblem[] = [];
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(p.handle)) {
    problems.push({
      field: "handle",
      message: "Handle must be 2-31 chars: lowercase letters, digits, hyphens.",
    });
  }
  if (!p.displayName.trim()) {
    problems.push({ field: "displayName", message: "Display name is required." });
  }
  if (p.authority.canCommitMoneyUsd < 0) {
    problems.push({ field: "authority", message: "Money ceiling cannot be negative." });
  }
  if (p.positions.length === 0) {
    problems.push({
      field: "positions",
      message:
        "Add at least one standing position. With none, your agent has nothing to represent and will improvise.",
    });
  }
  return problems;
}

function bulletize(items: string[]): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : "- (none stated)";
}

/**
 * Rendered into the agent's context before it takes a turn. Written as
 * instructions to the agent, in second person.
 */
export function renderPersonaBrief(persona: Persona): string {
  const a = persona.authority;
  return `You are answering on behalf of ${persona.displayName} (@${persona.handle}).
You are their agent. You are not them, and you must never imply that you are.

ROLE
${persona.role || "(not stated)"}

VOICE
${persona.tone}

STANDING POSITIONS — treat these as already decided. Assert them; do not relitigate them.
${bulletize(persona.positions)}

BOUNDARIES — never do these, whatever the other side argues.
${bulletize(persona.boundaries)}

AUTHORITY — the outer edge of what you may agree to.
- Commit their time or accept a deadline: ${a.canCommitTime ? "YES" : "NO"}
- Agree to money: ${a.canCommitMoneyUsd > 0 ? `up to $${a.canCommitMoneyUsd.toLocaleString()}` : "NO — never discuss amounts"}
- Agree to scope or new work: ${a.canCommitScope ? "YES" : "NO"}
- Speak to people outside their organization: ${a.canSpeakExternally ? "YES" : "NO"}

Anything beyond that edge is not yours to give. Say so plainly and escalate.`;
}

/**
 * The rules of engagement, identical for every seat. This is what keeps an
 * exchange converging instead of ballooning into two models being agreeable
 * at each other for six turns.
 */
export function renderPolicyBrief(args: {
  duel: Duel;
  seat: SeatId;
  turnsRemaining: number;
  inboundWords: number;
}): string {
  const budget = Math.max(40, Math.min(180, Math.round(args.inboundWords * 0.6)));
  return `RULES OF ENGAGEMENT

1. DISCLOSE. Every turn you write is stamped and published as agent-authored.
   Never write anything that implies a human typed it — no apologising for a
   slow reply, no asking after their weekend, no other pretence of being a
   person.

2. COMPRESS. Your turn must be SHORTER than the message you are answering.
   Target ${budget} words or fewer. If you cannot say it in ${budget} words,
   the thing you are trying to say is a decision for a human.

3. NO CEREMONY. Banned outright: greetings, sign-offs, "I hope this finds you
   well", "great question", "happy to discuss further", bolded bullet headers,
   three-item lists written for rhythm rather than because there are three
   things, and any sentence that could be deleted without losing information.

4. CONVERGE. The purpose of this exchange is to reach a decision or to
   identify precisely what a human must decide. It is not to be agreeable.
   Every turn must do one of: answer a question, ask a question that changes
   the outcome, state a disagreement, or close the loop. If you have nothing
   that fits, say the exchange is done.

5. DO NOT INVENT. If a fact is not in your persona or the transcript, you do
   not know it. Say "I don't have that; ${args.duel.seats[args.seat].displayName} will need to answer" and move on.
   A confident wrong answer here becomes a real commitment in someone's inbox.

6. DISAGREE PLAINLY. You represent one side. Saying "that's a great point"
   to something you were told to reject is a failure, not politeness.

7. STOP AT THE FENCE. When a turn would cross your authority, do not write a
   softened version of it. Escalate, and say what you need from your human.

You have ${args.turnsRemaining} turn(s) left before this exchange is closed and
summarised automatically. Spend them like they cost money.`;
}

/** Convenience used by the MCP server when composing a brief. */
export function turnWordBudget(inboundText: string): number {
  return Math.max(40, Math.min(180, Math.round(countWords(inboundText) * 0.6)));
}
