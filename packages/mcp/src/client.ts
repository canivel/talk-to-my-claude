/**
 * Thin REST client for the TTMC relay.
 *
 * Note what is absent: any model provider SDK. This process never calls an
 * inference API. The Claude reading these tool results IS the model — that is
 * the whole architecture, and the day this file grows an `anthropic` import is
 * the day the economics of the product change.
 */

import type {
  Digest,
  Duel,
  Escalation,
  SeatId,
  SlopReport,
  TurnBrief,
} from "@ttmc/core";

export class TtmcError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "TtmcError";
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

export interface PostTurnResult {
  turn: { index: number; wordCount: number };
  duel: { id: string; code: string; status: Duel["status"]; turnOf: SeatId | null };
  /** Raised escalations. Non-empty means the turn was held, not delivered. */
  escalations: Escalation[];
  delivered: boolean;
  /** The exact text to paste elsewhere, disclosure footer included. */
  disclosedText: string | null;
  url: string;
}

export interface TtmcClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class TtmcClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TtmcClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new TtmcError(
        `Cannot reach the TTMC relay at ${this.baseUrl}. Is it running, and is TTMC_API_URL correct?`,
        0,
        cause,
      );
    }

    const text = await res.text();
    const payload = text ? safeJson(text) : null;

    if (!res.ok) {
      const message =
        (payload as { error?: string } | null)?.error ??
        `${method} ${path} failed with ${res.status}`;
      throw new TtmcError(message, res.status, payload);
    }
    return payload as T;
  }

  me() {
    return this.request<{
      userId: string;
      handle: string | null;
      displayName: string;
      hasPersona: boolean;
      personaVersion: number | null;
    }>("GET", "/api/v1/me");
  }

  inbox() {
    return this.request<{ duels: DuelSummary[] }>("GET", "/api/v1/duels?awaiting=me");
  }

  openDuel(input: {
    subject: string;
    inboundMessage?: string;
    counterpartName?: string;
    maxTurns?: number;
    visibility?: Duel["visibility"];
  }) {
    return this.request<{ duel: DuelSummary; brief: TurnBrief | null }>(
      "POST",
      "/api/v1/duels",
      input,
    );
  }

  join(codeOrId: string, mode: "mcp" | "byok" | "human" = "mcp") {
    return this.request<{ duel: DuelSummary; brief: TurnBrief | null }>(
      "POST",
      `/api/v1/duels/${encodeURIComponent(codeOrId)}/join`,
      { mode },
    );
  }

  brief(codeOrId: string) {
    return this.request<TurnBrief>(
      "GET",
      `/api/v1/duels/${encodeURIComponent(codeOrId)}/brief`,
    );
  }

  postTurn(
    codeOrId: string,
    input: { content: string; model?: string; humanReviewed?: boolean; confidence?: number },
  ) {
    return this.request<PostTurnResult>(
      "POST",
      `/api/v1/duels/${encodeURIComponent(codeOrId)}/turns`,
      input,
    );
  }

  escalate(codeOrId: string, reason: string) {
    return this.request<{ escalation: Escalation; url: string }>(
      "POST",
      `/api/v1/duels/${encodeURIComponent(codeOrId)}/escalate`,
      { reason },
    );
  }

  submitDigest(codeOrId: string, draft: unknown) {
    return this.request<{
      digest: Digest;
      markdown: string;
      problems: Array<{ field: string; message: string }>;
      url: string;
    }>("POST", `/api/v1/duels/${encodeURIComponent(codeOrId)}/digest`, { draft });
  }

  slop(text: string) {
    return this.request<SlopReport>("POST", "/api/v1/slop", { text });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}
