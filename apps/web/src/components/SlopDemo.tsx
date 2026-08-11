"use client";

import { useState, useTransition } from "react";
import type { SlopReport } from "@ttmc/core";
import { SlopMeter } from "./SlopMeter";

const SAMPLE = `Hi there! I hope this email finds you well.

Thanks for reaching out about the Q3 roadmap. It's important to note that this
is not just a planning exercise, it's a strategic alignment opportunity. As we
navigate this evolving landscape, we should leverage a holistic approach that
empowers our teams to deliver robust, scalable, and maintainable outcomes.

- **Visibility**: Ensuring stakeholders have a clear line of sight.
- **Cadence**: A regular sync will foster transparency and unlock momentum.
- **Ownership**: Clear accountability is crucial to this initiative.

That said, there are several factors to consider. Ultimately, the cornerstone of
any transformative effort is trust in the process.

Let me know if you have any questions. Happy to discuss further!`;

export function SlopDemo() {
  const [text, setText] = useState("");
  const [report, setReport] = useState<SlopReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function score(value: string) {
    setErr(null);
    start(async () => {
      try {
        const res = await fetch("/api/v1/slop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Scoring failed.");
        setReport(await res.json());
      } catch (e) {
        setErr((e as Error).message);
        setReport(null);
      }
    });
  }

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="label">Paste something someone AI&apos;d at you</p>
        <button
          type="button"
          className="text-xs text-[var(--color-faint)] underline underline-offset-4 hover:text-[var(--color-muted)]"
          onClick={() => {
            setText(SAMPLE);
            score(SAMPLE);
          }}
        >
          use an example
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        placeholder="Hi there! I hope this email finds you well…"
        className="field mt-3 resize-y font-mono text-[0.8125rem] leading-relaxed"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || text.trim().length === 0}
          onClick={() => score(text)}
        >
          {pending ? "Scoring…" : "Score it"}
        </button>
        <span className="text-xs text-[var(--color-faint)]">
          Runs locally on the server. Nothing is stored, no model is called.
        </span>
      </div>

      {err && <p className="mt-4 text-sm text-[var(--color-danger)]">{err}</p>}

      {report && (
        <div className="mt-6 border-t border-[var(--color-edge)] pt-5">
          <SlopMeter report={report} />
        </div>
      )}
    </div>
  );
}
