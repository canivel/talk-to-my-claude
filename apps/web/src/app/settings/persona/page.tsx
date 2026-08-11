import type { Metadata } from "next";
import Link from "next/link";
import { renderPersonaBrief, validatePersona } from "@ttmc/core";
import { savePersonaAction } from "@/app/actions";
import { personaFor, sessionIdentity } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your persona" };

function Field({
  name,
  label,
  hint,
  placeholder,
  defaultValue,
  rows = 5,
}: {
  name: string;
  label: string;
  hint: string;
  placeholder: string;
  defaultValue: string;
  rows?: number;
}) {
  return (
    <div>
      <label htmlFor={name} className="label">
        {label}
      </label>
      <p className="mt-1.5 text-sm text-[var(--color-muted)]">{hint}</p>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="field mt-2 resize-y text-[0.875rem] leading-relaxed"
      />
    </div>
  );
}

export default async function PersonaPage() {
  const identity = await sessionIdentity();
  if (!identity) {
    return (
      <div className="panel p-6">
        <h1 className="text-xl font-semibold">Sign in to edit your persona.</h1>
      </div>
    );
  }

  const persona = await personaFor(identity);
  const problems = validatePersona(persona);
  const a = persona.authority;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="label">Persona · version {persona.version}</p>
        <p className="font-mono text-xs text-[var(--color-faint)]">
          @{persona.handle}
        </p>
      </div>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        What your agent is allowed to say
      </h1>
      <p className="mt-3 leading-relaxed text-[var(--color-muted)]">
        This is the difference between an agent that represents you and one that
        improvises something agreeable. Without standing positions it has nothing
        to assert, so it hedges — which is exactly the output this whole product
        exists to complain about.
      </p>

      {problems.length > 0 && (
        <div className="panel mt-6 border-[var(--color-warn)] p-4">
          <p className="label" style={{ color: "var(--color-warn)" }}>
            Worth fixing
          </p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-muted)]">
            {problems.map((p) => (
              <li key={p.field}>— {p.message}</li>
            ))}
          </ul>
        </div>
      )}

      <form action={savePersonaAction} className="mt-8 space-y-7">
        <div>
          <label htmlFor="role" className="label">
            Role
          </label>
          <input
            id="role"
            name="role"
            defaultValue={persona.role}
            placeholder="Director of AI Engineering, owns the platform team"
            className="field mt-2"
          />
        </div>

        <div>
          <label htmlFor="tone" className="label">
            Voice
          </label>
          <p className="mt-1.5 text-sm text-[var(--color-muted)]">
            Short beats long. &ldquo;Direct, no corporate register&rdquo; does more
            work than a paragraph.
          </p>
          <input
            id="tone"
            name="tone"
            defaultValue={persona.tone}
            className="field mt-2"
          />
        </div>

        <Field
          name="positions"
          label="Standing positions"
          hint="One per line. Treated as already decided — your agent asserts these rather than relitigating them. This is the field that matters most."
          placeholder={
            "Postgres is decided; do not reopen the database question.\nMy team owns ingestion, not the dashboards.\nNo meetings before 10am."
          }
          defaultValue={persona.positions.join("\n")}
          rows={6}
        />

        <Field
          name="boundaries"
          label="Boundaries"
          hint="One per line. Never done, whatever the other side argues."
          placeholder={
            "Never agree to weekend work.\nNever commit another team's roadmap."
          }
          defaultValue={persona.boundaries.join("\n")}
        />

        <Field
          name="escalateOn"
          label="Always ask me about"
          hint="One per line. Extra triggers on top of the built-in gate, which already stops at money, calendar, scope, contracts, credentials, and conflict."
          placeholder={"Anything involving the Q3 reorg.\nAnything from the CFO."}
          defaultValue={persona.escalateOn.join("\n")}
          rows={4}
        />

        <fieldset className="panel p-5">
          <legend className="label px-2">Authority ceilings</legend>
          <p className="mb-4 text-sm text-[var(--color-muted)]">
            The outer edge of what your agent may agree to. Crossing any of these
            holds the turn and asks you instead — before anything is signed or
            written to the transcript.
          </p>

          <div className="space-y-3">
            {[
              {
                name: "canCommitTime",
                checked: a.canCommitTime,
                label: "Commit my time — accept meetings and deadlines",
              },
              {
                name: "canCommitScope",
                checked: a.canCommitScope,
                label: "Agree to scope — take on new work",
              },
              {
                name: "canSpeakExternally",
                checked: a.canSpeakExternally,
                label: "Speak to people outside my organization",
              },
            ].map((f) => (
              <label key={f.name} className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name={f.name}
                  defaultChecked={f.checked}
                  className="mt-0.5"
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>

          <div className="mt-5">
            <label htmlFor="canCommitMoneyUsd" className="label">
              Money ceiling (USD)
            </label>
            <input
              id="canCommitMoneyUsd"
              name="canCommitMoneyUsd"
              type="number"
              min={0}
              step={100}
              defaultValue={a.canCommitMoneyUsd}
              className="field mt-2"
            />
            <p className="mt-2 text-xs text-[var(--color-faint)]">
              0 means never discuss amounts at all. Anything above this escalates.
            </p>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary">
            Save persona
          </button>
          <p className="text-xs text-[var(--color-faint)]">
            A real change bumps you to v{persona.version + 1}. Disclosure stamps
            cite the version, so past messages keep pointing at the positions that
            actually wrote them.
          </p>
        </div>
      </form>

      <section className="mt-12">
        <p className="label">What your agent actually receives</p>
        <p className="mt-2 mb-3 text-sm text-[var(--color-muted)]">
          Rendered from the fields above and handed to your Claude before every
          turn. No hidden prompt.
        </p>
        <pre className="panel overflow-x-auto p-4 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-[var(--color-muted)]">
          {renderPersonaBrief(persona)}
        </pre>
      </section>

      <p className="mt-8 text-sm text-[var(--color-muted)]">
        Next:{" "}
        <Link href="/settings/connect" className="underline underline-offset-4">
          connect your Claude
        </Link>
        .
      </p>
    </div>
  );
}
