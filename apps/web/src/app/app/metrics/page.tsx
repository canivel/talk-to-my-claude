import type { Metadata } from "next";
import Link from "next/link";
import type { Health } from "@ttmc/core";
import { sessionIdentity } from "@/server/auth";
import { metricsFor } from "@/server/relay";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Metrics" };

const HEALTH_COLOR: Record<Health, string> = {
  good: "var(--color-good)",
  watch: "var(--color-warn)",
  bad: "var(--color-danger)",
  unknown: "var(--color-faint)",
};

const HEALTH_LABEL: Record<Health, string> = {
  good: "on target",
  watch: "watch",
  bad: "off target",
  unknown: "not enough data",
};

export default async function MetricsPage() {
  const identity = await sessionIdentity();
  if (!identity) {
    return (
      <div className="panel p-6">
        <h1 className="text-xl font-semibold">Sign in to see your metrics.</h1>
      </div>
    );
  }

  const m = await metricsFor(identity);

  return (
    <div>
      <p className="label">Measurement</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Is this actually working?
      </h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-[var(--color-muted)]">
        These are the success criteria from{" "}
        <span className="font-mono text-sm">docs/market.md</span>, measured rather
        than asserted. The thresholds live in the code, so the claim and the
        number cannot quietly drift apart.
      </p>

      <div className="mt-6 flex gap-8">
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {m.totalExchanges}
          </p>
          <p className="label">exchanges</p>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {m.completed}
          </p>
          <p className="label">completed</p>
        </div>
      </div>

      {m.totalExchanges === 0 ? (
        <div className="panel mt-8 p-8 text-center">
          <p className="text-[var(--color-muted)]">
            Nothing measured yet. Run a few exchanges and come back.
          </p>
          <Link href="/new" className="btn btn-primary mt-4">
            Start one
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {m.criteria.map((c) => (
            <div key={c.id} className="panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <span
                    className="font-mono text-2xl font-semibold tabular-nums"
                    style={{ color: HEALTH_COLOR[c.health] }}
                  >
                    {c.display}
                  </span>
                  <span className="font-medium">{c.label}</span>
                </div>
                <div className="text-right">
                  <span className="label" style={{ color: HEALTH_COLOR[c.health] }}>
                    {HEALTH_LABEL[c.health]}
                  </span>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-faint)]">
                    target {c.target}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm text-[var(--color-muted)]">{c.note}</p>
            </div>
          ))}
        </div>
      )}

      {(m.inboundMeanSlop !== null || m.agentMeanSlop !== null) && (
        <section className="panel mt-8 p-5">
          <p className="label">Boilerplate, inbound vs. outbound</p>
          <div className="mt-4 flex flex-wrap gap-10">
            <div>
              <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-seat-b)]">
                {m.inboundMeanSlop === null ? "—" : Math.round(m.inboundMeanSlop)}
              </p>
              <p className="label">what they send you</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-semibold tabular-nums text-[var(--color-seat-a)]">
                {m.agentMeanSlop === null ? "—" : Math.round(m.agentMeanSlop)}
              </p>
              <p className="label">what your agent sends</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            Your own agent is scored on the same scale as everyone else, and the
            second number should stay well below the first. If it doesn&apos;t,
            your agent has started producing the thing you built this to avoid —
            tighten the voice guidance in{" "}
            <Link href="/settings/persona" className="underline underline-offset-4">
              your persona
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}
