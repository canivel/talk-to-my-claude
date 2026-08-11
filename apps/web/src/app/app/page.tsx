import type { Metadata } from "next";
import Link from "next/link";
import { personaFor, sessionIdentity } from "@/server/auth";
import { listExchanges } from "@/server/relay";
import { storageMode } from "@/server/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Exchanges" };

export default async function DashboardPage() {
  const identity = await sessionIdentity();
  if (!identity) {
    return (
      <div className="panel p-6">
        <h1 className="text-xl font-semibold">Sign in to see your exchanges.</h1>
      </div>
    );
  }

  const [exchanges, persona] = await Promise.all([
    listExchanges(identity),
    personaFor(identity),
  ]);
  const waiting = exchanges.filter((e) => e.awaitingYou);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Signed in as {identity.displayName}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Exchanges</h1>
          <p className="mt-2 text-[var(--color-muted)]">
            {waiting.length > 0
              ? `${waiting.length} waiting on your agent.`
              : "Nothing waiting on you."}
          </p>
        </div>
        <Link href="/new" className="btn btn-primary">
          Answer something
        </Link>
      </div>

      {/* An untouched persona is the single biggest predictor of bad output, so
          it gets called out ahead of anything else on this page. */}
      {persona.version === 1 && persona.role === "" && (
        <div className="panel mt-6 border-[var(--color-seat-a)] p-4">
          <p className="label" style={{ color: "var(--color-seat-a)" }}>
            Your persona is empty
          </p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Your agent has no standing positions to represent, so it will hedge
            rather than answer — which is the output this product exists to
            complain about. Five minutes here changes every reply.
          </p>
          <Link href="/settings/persona" className="btn mt-3 !px-3 !py-1.5 !text-xs">
            Write your positions
          </Link>
        </div>
      )}

      {storageMode === "memory" && (
        <p className="panel mt-6 p-4 text-sm text-[var(--color-muted)]">
          <span className="label">In-memory storage</span>{" "}
          No <code className="font-mono text-xs">DATABASE_URL</code> is set, so
          everything here disappears when the server restarts. Fine for a look
          around; set one before you rely on it.
        </p>
      )}

      <div className="mt-8 space-y-3">
        {exchanges.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="text-[var(--color-muted)]">
              Nothing here yet. Paste in the last message that made you sigh.
            </p>
            <Link href="/new" className="btn btn-primary mt-4">
              Start one
            </Link>
          </div>
        )}

        {exchanges.map((e) => (
          <Link
            key={e.id}
            href={`/d/${e.code}`}
            className="panel flex flex-wrap items-center justify-between gap-4 p-4 transition-colors hover:border-[var(--color-edge-bright)]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs text-[var(--color-faint)]">
                  {e.code}
                </span>
                {e.awaitingYou && (
                  <span
                    className="label !text-[0.625rem]"
                    style={{ color: "var(--color-seat-a)" }}
                  >
                    your turn
                  </span>
                )}
              </div>
              <p className="mt-1 truncate font-medium">{e.subject}</p>
              <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                vs {e.counterpart}
              </p>
            </div>
            <div className="text-right">
              <p
                className="label"
                style={{
                  color:
                    e.status === "live"
                      ? "var(--color-good)"
                      : e.status === "escalated"
                        ? "var(--color-danger)"
                        : "var(--color-muted)",
                }}
              >
                {e.status}
              </p>
              <p className="mt-1 font-mono text-xs text-[var(--color-faint)]">
                {e.turnCount} turns
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
