import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  buildTurnBrief,
  renderDigestMarkdown,
  stampId,
  turnsRemaining,
  type Duel,
  type SeatId,
  type Turn,
} from "@ttmc/core";
import { submitReplyAction } from "@/app/actions";
import { CopyButton } from "@/components/CopyButton";
import { SlopMeter } from "@/components/SlopMeter";
import { personaFor, sessionIdentity } from "@/server/auth";
import { digestFor, loadDuel, seatOf } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  try {
    const duel = await loadDuel(code);
    return { title: duel.subject };
  } catch {
    return { title: "Exchange not found" };
  }
}

const SEAT_STYLE: Record<SeatId, { color: string; dim: string }> = {
  A: { color: "var(--color-seat-a)", dim: "var(--color-seat-a-dim)" },
  B: { color: "var(--color-seat-b)", dim: "var(--color-seat-b-dim)" },
};

const AUTHOR_LABEL: Record<Turn["author"], string> = {
  agent: "agent · signed",
  human: "human · signed",
  unattributed: "pasted · provenance unknown",
  system: "system",
};

function TurnCard({ turn, duel }: { turn: Turn; duel: Duel }) {
  const style = SEAT_STYLE[turn.seat];
  const speaker = duel.seats[turn.seat].displayName;

  return (
    <article className="panel overflow-hidden">
      <header
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-edge)] px-4 py-2.5"
        style={{ background: style.dim }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="font-mono text-xs font-semibold tabular-nums"
            style={{ color: style.color }}
          >
            {turn.index.toString().padStart(2, "0")}
          </span>
          <span className="text-sm font-medium">{speaker}</span>
          <span className="label !text-[0.625rem]">{AUTHOR_LABEL[turn.author]}</span>
        </div>
        <div className="flex items-center gap-3">
          {turn.slop && (
            <span className="font-mono text-xs text-[var(--color-faint)]">
              slop {turn.slop.score}
            </span>
          )}
          <span className="font-mono text-xs text-[var(--color-faint)]">
            {turn.wordCount}w
          </span>
        </div>
      </header>

      <div className="px-4 py-3.5 text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
        {turn.content}
      </div>

      {turn.provenance && (
        <footer className="border-t border-[var(--color-edge)] px-4 py-2 font-mono text-[0.6875rem] text-[var(--color-faint)]">
          {turn.provenance.model ?? "human-written"}
          {turn.provenance.persona &&
            ` · persona ${turn.provenance.persona.handle}@${turn.provenance.persona.version}`}
          {" · "}
          {turn.provenance.humanReviewed ? "human-reviewed" : "not human-reviewed"}
          {" · "}
          <a
            href={`/v/${stampId(turn.provenance)}`}
            className="underline underline-offset-2 hover:text-[var(--color-muted)]"
          >
            verify
          </a>
        </footer>
      )}
    </article>
  );
}

export default async function DuelPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  let duel: Duel;
  try {
    duel = await loadDuel(code);
  } catch {
    notFound();
  }

  const identity = await sessionIdentity();
  const mySeat = identity ? seatOf(duel, identity.userId) : null;

  // Private exchanges are readable only by their seat holders. Unlisted and
  // public ones are readable by anyone holding the code, which is the point.
  if (duel.visibility === "private" && !mySeat) notFound();

  const digest = digestFor(duel);
  const myTurn = mySeat !== null && duel.turnOf === mySeat && duel.status === "live";
  const brief =
    myTurn && identity ? buildTurnBrief(duel, mySeat, await personaFor(identity)) : null;

  const briefText = brief
    ? [
        brief.personaBrief,
        "",
        brief.policyBrief,
        "",
        "TRANSCRIPT SO FAR",
        ...brief.transcript.map((t) => `\n[${t.index}] ${t.speaker}:\n${t.content}`),
        "",
        "Write the reply now. Output only the reply text — no preamble, no sign-off.",
      ].join("\n")
    : null;

  const lastInbound = [...duel.turns].reverse().find((t) => t.seat !== mySeat);
  const openEscalations = duel.escalations.filter((e) => e.resolvedAt === null);

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <span className="label">{duel.code}</span>
          <span
            className="label"
            style={{
              color:
                duel.status === "live"
                  ? "var(--color-good)"
                  : duel.status === "escalated"
                    ? "var(--color-danger)"
                    : "var(--color-muted)",
            }}
          >
            {duel.status}
          </span>
          {duel.status === "live" && (
            <span className="label">{turnsRemaining(duel)} turns left</span>
          )}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{duel.subject}</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          <span style={{ color: SEAT_STYLE.A.color }}>{duel.seats.A.displayName}</span>
          <span className="text-[var(--color-faint)]"> vs </span>
          <span style={{ color: SEAT_STYLE.B.color }}>{duel.seats.B.displayName}</span>
        </p>
      </header>

      {openEscalations.length > 0 && (
        <section className="panel border-[var(--color-danger)] p-5">
          <p className="label" style={{ color: "var(--color-danger)" }}>
            Stopped — this needs you
          </p>
          <ul className="mt-3 space-y-2">
            {openEscalations.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="font-mono text-xs text-[var(--color-faint)]">
                  {e.trigger}
                </span>
                <p className="mt-0.5">{e.reason}</p>
                {e.evidence.length > 0 && (
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-faint)]">
                    {e.evidence.join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            The turn that tripped this was never written to the transcript. Nothing was
            sent.
          </p>
        </section>
      )}

      {digest && (
        <section className="panel p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="label">The part a human reads</p>
            <div className="text-right">
              <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-seat-a)]">
                {digest.stats.compressionRatio}×
              </p>
              <p className="label !text-[0.625rem]">compression</p>
            </div>
          </div>
          <p className="mt-3 text-lg leading-relaxed">{digest.headline}</p>

          {digest.needsHuman.length > 0 && (
            <div className="mt-5">
              <p className="label">Needs you</p>
              <ul className="mt-2 space-y-1 text-sm">
                {digest.needsHuman.map((n) => (
                  <li key={n}>— {n}</li>
                ))}
              </ul>
            </div>
          )}
          {digest.decisions.length > 0 && (
            <div className="mt-5">
              <p className="label">Decided</p>
              <ul className="mt-2 space-y-1 text-sm">
                {digest.decisions.map((d) => (
                  <li key={d.text}>— {d.text}</li>
                ))}
              </ul>
            </div>
          )}
          {digest.openQuestions.length > 0 && (
            <div className="mt-5">
              <p className="label">Still open</p>
              <ul className="mt-2 space-y-1 text-sm">
                {digest.openQuestions.map((q) => (
                  <li key={q.text}>— {q.text}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-5 border-t border-[var(--color-edge)] pt-3 font-mono text-xs text-[var(--color-faint)]">
            {digest.stats.inboundWords}w in → {digest.stats.digestWords}w out ·{" "}
            {digest.stats.turnCount} turns
            {digest.stats.meanSlop !== null && ` · mean slop ${digest.stats.meanSlop}`}
          </p>

          <div className="mt-4">
            <CopyButton
              text={renderDigestMarkdown(digest, duel)}
              label="Copy digest as Markdown"
              className="!px-3 !py-1.5 !text-xs"
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <p className="label">Transcript</p>
        {duel.turns.length === 0 ? (
          <p className="panel p-5 text-sm text-[var(--color-muted)]">
            Nothing yet.
          </p>
        ) : (
          duel.turns.map((t) => <TurnCard key={t.id} turn={t} duel={duel} />)
        )}
      </section>

      {lastInbound?.slop && (
        <section className="panel p-5">
          <p className="label">Inbound analysis · turn {lastInbound.index}</p>
          <div className="mt-3">
            <SlopMeter report={lastInbound.slop} />
          </div>
        </section>
      )}

      {myTurn && briefText && (
        <section className="panel p-5">
          <p className="label">Your turn</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            If you have connected your Claude over MCP, it can take this turn
            directly. Otherwise: copy the brief, paste it into any Claude you have
            open, and paste the reply back here.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <CopyButton text={briefText} label="Copy brief for your Claude" />
          </div>

          <form action={submitReplyAction} className="mt-5 space-y-3">
            <input type="hidden" name="code" value={duel.code} />
            <textarea
              name="content"
              rows={7}
              required
              placeholder="Paste your Claude's reply here…"
              className="field resize-y font-mono text-[0.8125rem] leading-relaxed"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                <input type="checkbox" name="author" value="human" />
                I wrote this myself, no agent involved
              </label>
              <button type="submit" className="btn btn-primary">
                Submit turn
              </button>
            </div>
            <p className="text-xs text-[var(--color-faint)]">
              The escalation gate runs before this is signed. If it commits money,
              time, scope, or touches contracts or conflict beyond what your persona
              authorises, it is held rather than delivered.
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
