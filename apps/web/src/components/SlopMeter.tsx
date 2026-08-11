import type { SlopReport } from "@ttmc/core";

const BAND_COLOR: Record<SlopReport["band"], string> = {
  human: "var(--color-good)",
  assisted: "var(--color-seat-b)",
  "likely-ai": "var(--color-warn)",
  "pure-slop": "var(--color-danger)",
};

const BAND_LABEL: Record<SlopReport["band"], string> = {
  human: "Human",
  assisted: "Assisted",
  "likely-ai": "Mostly ceremony",
  "pure-slop": "Pure slop",
};

export function SlopMeter({
  report,
  showSignals = true,
}: {
  report: SlopReport;
  showSignals?: boolean;
}) {
  const color = BAND_COLOR[report.band];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-3xl font-semibold tabular-nums"
            style={{ color }}
          >
            {report.score}
          </span>
          <span className="text-sm text-[var(--color-faint)]">/100</span>
        </div>
        <span className="label" style={{ color }}>
          {BAND_LABEL[report.band]}
        </span>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-panel-2)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${report.score}%`, background: color }}
        />
      </div>

      <p className="mt-3 text-sm text-[var(--color-muted)]">{report.verdict}</p>

      {showSignals && report.signals.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {report.signals.slice(0, 5).map((s) => (
            <li key={s.id} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 font-mono text-xs tabular-nums text-[var(--color-faint)]">
                +{s.points}
              </span>
              <span className="flex-1">
                <span className="text-[var(--color-text)]">{s.label}</span>
                {s.evidence.length > 0 && (
                  <span className="text-[var(--color-faint)]">
                    {" — "}
                    {s.evidence.slice(0, 3).join(", ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 border-t border-[var(--color-edge)] pt-3 text-xs text-[var(--color-faint)]">
        Measures boilerplate density, not authorship. Edited model output scores low;
        a human writing in corporate register scores high. It describes the text, not
        the person — for authorship there is{" "}
        <span className="text-[var(--color-muted)]">only the signature</span>.
      </p>
    </div>
  );
}
