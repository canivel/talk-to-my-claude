import type { Metadata } from "next";
import { createExchangeAction } from "@/app/actions";

export const metadata: Metadata = { title: "Answer something" };

export default function NewExchangePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="label">New exchange</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        What did they send you?
      </h1>
      <p className="mt-3 text-[var(--color-muted)]">
        Paste it verbatim — do not clean it up. It is seated as the opening turn
        and scored for boilerplate, and then your Claude gets to answer it.
      </p>

      <form action={createExchangeAction} className="mt-8 space-y-5">
        <div>
          <label htmlFor="inboundMessage" className="label">
            The message you received
          </label>
          <textarea
            id="inboundMessage"
            name="inboundMessage"
            rows={12}
            required
            placeholder="Hi! Just circling back on this. I wanted to reach out because…"
            className="field mt-2 resize-y font-mono text-[0.8125rem] leading-relaxed"
          />
          <p className="mt-2 text-xs text-[var(--color-faint)]">
            This turn is stored <strong>unsigned</strong>. We know you pasted it
            and nothing more — asserting who wrote it would undermine every
            signature we do issue.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="counterpartName" className="label">
              Who sent it
            </label>
            <input
              id="counterpartName"
              name="counterpartName"
              placeholder="Raj"
              className="field mt-2"
            />
          </div>
          <div>
            <label htmlFor="subject" className="label">
              Subject <span className="normal-case">(optional)</span>
            </label>
            <input
              id="subject"
              name="subject"
              placeholder="Taken from the first line"
              className="field mt-2"
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="maxTurns" className="label">
              Turn cap
            </label>
            <select id="maxTurns" name="maxTurns" defaultValue="6" className="field mt-2">
              <option value="2">2 — one reply and done</option>
              <option value="4">4</option>
              <option value="6">6 — default</option>
              <option value="10">10</option>
            </select>
            <p className="mt-2 text-xs text-[var(--color-faint)]">
              Hard ceiling. It also stops early once turns stop saying anything new.
            </p>
          </div>
          <div>
            <label htmlFor="visibility" className="label">
              Visibility
            </label>
            <select
              id="visibility"
              name="visibility"
              defaultValue="private"
              className="field mt-2"
            >
              <option value="private">Private — only you</option>
              <option value="unlisted">Unlisted — anyone with the link</option>
            </select>
            <p className="mt-2 text-xs text-[var(--color-faint)]">
              <span className="text-[var(--color-muted)]">Unlisted</span> gives you a
              shareable transcript link. Anyone with it can read the exchange.
            </p>
          </div>
        </div>

        <button type="submit" className="btn btn-primary w-full">
          Open the exchange
        </button>
      </form>
    </div>
  );
}
