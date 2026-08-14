/**
 * Domain types for the TTMC relay.
 *
 * Vocabulary note: the product calls a conversation a "duel" because that is
 * the joke that gets people to try it. The enterprise surface calls the same
 * object an "exchange". They are the same record; only the label differs.
 */

/** A duel has exactly two seats. Not a group chat — that is a different product. */
export type SeatId = "A" | "B";

/**
 * How the model behind a seat is reached.
 *
 * `mcp`   — the participant's own Claude connects to TTMC as an MCP client.
 *           TTMC never sees an inference key and never pays for a token.
 * `paste` — a human copies text in and out. This is the common case at the
 *           start, because the other side is usually a person pasting from
 *           their own chat window and has never heard of us.
 * `byok`  — a server-side agent runs with the seat owner's own provider key,
 *           so a duel can advance while they are asleep.
 * `human` — the seat holder is answering personally, with no model involved.
 *           Kept as a first-class mode so "a human took over" is representable.
 */
export type SeatMode = "mcp" | "paste" | "byok" | "human";

/**
 * Who actually produced the words in a turn. This is the claim we sign, so the
 * set is deliberately small and each member means something we can stand behind.
 *
 * `unattributed` is the important one: text a user pasted in from elsewhere. We
 * know a human put it into TTMC and nothing more — not whether a person or a
 * model wrote it. Such turns never receive a provenance stamp, because signing
 * one would assert something we cannot know. The slop score is the only thing
 * we offer about them, and it is explicitly a guess about style, not origin.
 */
export type AuthorKind = "agent" | "human" | "unattributed" | "system";

export type DuelStatus =
  | "live"
  | "converged"
  | "escalated"
  | "closed"
  | "expired";

/** Why a duel stopped advancing. `null` while it is still live. */
export type TerminationReason =
  | "converged"
  | "turn_cap"
  | "escalated"
  | "closed_by_owner"
  | "expired"
  | null;

export type Visibility = "private" | "unlisted" | "public";

/**
 * A participant's standing context — the thing that makes their agent able to
 * answer instead of hallucinate. Persona is versioned because a disclosure
 * stamp asserts *which* version spoke, and that claim has to stay checkable
 * after the persona is edited.
 */
export interface Persona {
  handle: string;
  displayName: string;
  /** One line: "Director of AI Engineering, owns the platform team." */
  role: string;
  /** Free-text voice guidance. Short beats long. */
  tone: string;
  /** Settled decisions the agent may assert as already true. */
  positions: string[];
  /** Things the agent must never do or say on the owner's behalf. */
  boundaries: string[];
  authority: Authority;
  /** Extra escalation triggers beyond the built-in gate. */
  escalateOn: string[];
  version: number;
  updatedAt: string;
}

/**
 * The blast radius of an agent speaking for you. Everything here is a ceiling,
 * not a permission: exceeding any of it forces escalation to the human.
 */
export interface Authority {
  /** May the agent agree to meetings / deadlines on the owner's calendar? */
  canCommitTime: boolean;
  /** Currency ceiling the agent may agree to. 0 means "never talk money". */
  canCommitMoneyUsd: number;
  /** May the agent agree to scope changes on work the owner owns? */
  canCommitScope: boolean;
  /** May the agent speak to people outside the owner's organization? */
  canSpeakExternally: boolean;
}

export interface Seat {
  id: SeatId;
  mode: SeatMode;
  /** Owning user, when the seat has been claimed. Unclaimed seats are `null`. */
  userId: string | null;
  handle: string | null;
  displayName: string;
  /** Snapshot of persona identity at seat time, for the disclosure stamp. */
  personaRef: PersonaRef | null;
  /** Model the seat reports it is using. Self-declared; we relay the claim. */
  model: string | null;
  joinedAt: string | null;
}

export interface PersonaRef {
  handle: string;
  version: number;
}

/** A single message in a duel. Immutable once written. */
export interface Turn {
  id: string;
  duelId: string;
  /** Monotonic from 1, gapless. Used for optimistic concurrency on posting. */
  index: number;
  seat: SeatId;
  author: AuthorKind;
  content: string;
  wordCount: number;
  /**
   * The disclosure. Null means TTMC makes no claim about who wrote this — the
   * case for pasted `unattributed` text.
   */
  provenance: ProvenanceStamp | null;
  /** Scored for every turn, including our own agents'. They do not get a pass. */
  slop: SlopReport | null;
  createdAt: string;
}

/**
 * TTMC-1 disclosure stamp. See docs/protocol.md.
 *
 * The point of the whole product: a machine-verifiable, non-strippable claim
 * about who wrote a message. Signed server-side so the author cannot forge
 * "a human wrote this".
 */
export interface ProvenanceStamp {
  /** Spec version. Currently always 1. */
  v: 1;
  duelId: string;
  turnIndex: number;
  seat: SeatId;
  author: AuthorKind;
  /** Self-declared model id, or null for human-authored turns. */
  model: string | null;
  persona: PersonaRef | null;
  /** Whether a human read this before it was sent. Usually false. That is the honest part. */
  humanReviewed: boolean;
  /** RFC3339 UTC. */
  ts: string;
  /** SHA-256 of the content, so the stamp binds to the exact words. */
  contentHash: string;
  /** base64url HMAC over the canonical form. */
  sig: string;
}

/** Everything needed to sign a stamp except the signature itself. */
export type UnsignedStamp = Omit<ProvenanceStamp, "sig" | "contentHash">;

export type SlopBand = "human" | "assisted" | "likely-ai" | "pure-slop";

/**
 * A boilerplate-density measurement — deliberately NOT called AI detection.
 * We measure stylistic tells that correlate with unedited model output. We do
 * not claim to know the provenance of unsigned text, because nobody can.
 */
export interface SlopReport {
  /** 0-100. Higher means more boilerplate per unit of information. */
  score: number;
  band: SlopBand;
  signals: SlopSignal[];
  wordCount: number;
  /** Words we estimate carry no information, as a fraction 0..1. */
  compressionOpportunity: number;
  /** Plain-English one-liner suitable for showing a user. */
  verdict: string;
}

export interface SlopSignal {
  id: SlopSignalId;
  label: string;
  /** 0..1 intensity for this signal. */
  intensity: number;
  /** Contribution to the final score, in points. */
  points: number;
  /** Literal snippets that fired the signal, for "show your work". */
  evidence: string[];
}

export type SlopSignalId =
  | "llm_lexicon"
  | "not_just_but"
  | "rule_of_three"
  | "hedging"
  | "boilerplate_open"
  | "boilerplate_close"
  | "enthusiasm"
  | "bold_bullets"
  | "sentence_uniformity"
  | "contraction_absence"
  | "emdash_density"
  | "specificity_drought";

/**
 * Why an agent stopped and handed control back to its human. The escalation
 * gate is the reason it is safe to let an agent speak for you at all.
 */
export interface Escalation {
  id: string;
  duelId: string;
  seat: SeatId;
  trigger: EscalationTrigger;
  reason: string;
  /** The text that tripped the gate. */
  evidence: string[];
  raisedAt: string;
  resolvedAt: string | null;
}

export type EscalationTrigger =
  | "money_over_authority"
  | "time_commitment"
  | "scope_commitment"
  | "external_party"
  | "legal_or_contractual"
  | "credentials_or_secrets"
  | "interpersonal_conflict"
  | "persona_boundary"
  | "low_confidence"
  | "explicit_request";

/**
 * The compressed output — the only artifact a human is expected to read.
 * A duel that does not shrink into one of these has failed.
 */
export interface Digest {
  duelId: string;
  /** Two sentences, max. The whole exchange for someone who will read nothing else. */
  headline: string;
  decisions: DigestItem[];
  openQuestions: DigestItem[];
  actionItems: ActionItem[];
  /** The specific things that genuinely require the human. Often empty. Good. */
  needsHuman: string[];
  stats: DigestStats;
  generatedAt: string;
  /** Which seat's agent assembled it. */
  generatedBySeat: SeatId | null;
}

export interface DigestItem {
  text: string;
  /** Turn indices this was drawn from, so every claim is traceable. */
  sourceTurns: number[];
}

export interface ActionItem extends DigestItem {
  owner: SeatId | "unassigned";
  /** ISO date or null. The agent must not invent one. */
  due: string | null;
}

export interface DigestStats {
  turnCount: number;
  /** Total words across all turns. */
  inboundWords: number;
  /** Words in the digest itself. */
  digestWords: number;
  /** inboundWords / digestWords. The headline number of the whole product. */
  compressionRatio: number;
  /** Mean slop score of scored turns, or null if none were scored. */
  meanSlop: number | null;
}

/**
 * Where an exchange came in from, and how to answer back into it. `ref` is
 * opaque per adapter — Slack puts channel and thread timestamp here, email will
 * put a message id. Kept in the domain rather than in an adapter-specific side
 * table because "answer this where it was asked" is a property of the exchange.
 */
export interface ExchangeOrigin {
  adapter: "web" | "slack" | "email" | "mcp";
  ref: Record<string, string>;
}

export interface Duel {
  id: string;
  /** Short URL-safe code for the public /d/<code> page. */
  code: string;
  subject: string;
  status: DuelStatus;
  termination: TerminationReason;
  seats: Record<SeatId, Seat>;
  /** Whose turn it is. Null once the duel is no longer live. */
  turnOf: SeatId | null;
  turns: Turn[];
  /** Hard ceiling on agent-to-agent turns before forced digest. */
  maxTurns: number;
  escalations: Escalation[];
  digest: Digest | null;
  visibility: Visibility;
  origin: ExchangeOrigin | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** What an MCP-connected agent is handed when it is asked to take its turn. */
export interface TurnBrief {
  duelId: string;
  code: string;
  subject: string;
  yourSeat: SeatId;
  opponent: { displayName: string; handle: string | null; mode: SeatMode };
  /** Rendered persona instructions for the agent taking this turn. */
  personaBrief: string;
  /** The policy the agent must obey, rendered as instructions. */
  policyBrief: string;
  transcript: Array<{
    index: number;
    seat: SeatId;
    author: AuthorKind;
    speaker: string;
    content: string;
  }>;
  turnsRemaining: number;
  /** Slop analysis of the most recent opposing turn, when available. */
  inboundSlop: SlopReport | null;
}
