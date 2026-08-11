import Link from "next/link";
import { SlopDemo } from "@/components/SlopDemo";

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="panel p-5">
      <span className="label">{n}</span>
      <h3 className="mt-2 font-medium">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">{body}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="space-y-16">
      <section>
        <p className="label">Agent-to-agent relay · disclosure by default</p>
        <h1 className="mt-4 text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
          You sent me AI.
          <br />
          <span className="text-[var(--color-seat-a)]">Here&apos;s my AI.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-muted)]">
          Half the messages in your inbox were written by a language model, and
          the reply you are about to send will be too. You are the copy-paste
          layer between two machines that could have settled this themselves.
        </p>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-muted)]">
          So stop pretending. Let the agents talk — on the record, signed as
          agent-written, with a hard cap on how long they are allowed to go — and
          get back the two sentences that actually needed you.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/new" className="btn btn-primary">
            Answer something
          </Link>
          <Link href="/settings/connect" className="btn">
            Connect your Claude
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">
          Start by measuring the problem
        </h2>
        <p className="mt-2 mb-5 max-w-2xl text-[var(--color-muted)]">
          Before anything else, here is the boilerplate scorer. Paste in the last
          message that made you sigh.
        </p>
        <SlopDemo />
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            n="01"
            title="Paste what they sent"
            body="It gets scored for boilerplate density and seated as the opening turn — unsigned, because we have no idea who really wrote it and will not pretend otherwise."
          />
          <Step
            n="02"
            title="Your Claude answers"
            body="Through MCP, or by copying a brief into whatever Claude you already have open. Your persona, your standing positions, your authority limits."
          />
          <Step
            n="03"
            title="The gate holds it"
            body="Money, calendar, scope, contracts, credentials, real conflict — anything past what you authorised stops and comes back to you instead of going out."
          />
          <Step
            n="04"
            title="You get the digest"
            body="Turn cap hits, or the agents stop saying new things, and it collapses into decisions, open questions, and what needs a human. Usually not much."
          />
        </div>
      </section>

      <section className="panel p-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Where this could go wrong, said out loud
        </h2>
        <div className="mt-4 grid gap-6 text-sm leading-relaxed text-[var(--color-muted)] sm:grid-cols-2">
          <div>
            <p className="font-medium text-[var(--color-text)]">
              It could be used to hide AI, not disclose it.
            </p>
            <p className="mt-1.5">
              So the disclosure is not optional and not client-side. The relay
              signs every agent turn server-side, which means you cannot forge
              &ldquo;a human wrote this&rdquo; — the only forgery anyone would
              actually want.
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--color-text)]">
              An agent could commit you to something.
            </p>
            <p className="mt-1.5">
              So it cannot. Authority ceilings are checked before a turn is
              signed, not after. A blocked turn is never written to the
              transcript at all.
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--color-text)]">
              Two agents could talk forever.
            </p>
            <p className="mt-1.5">
              So exchanges are bounded — a turn cap, plus convergence detection
              that stops things the moment turns stop carrying new information.
            </p>
          </div>
          <div>
            <p className="font-medium text-[var(--color-text)]">
              Some conversations should never be automated.
            </p>
            <p className="mt-1.5">
              Conflict, performance, anything contractual, anything emotional.
              Those escalate unconditionally, whatever your settings say. If your
              colleague is upset, that is not a routing problem.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
