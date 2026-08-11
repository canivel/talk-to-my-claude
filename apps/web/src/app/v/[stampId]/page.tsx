import type { Metadata } from "next";
import Link from "next/link";
import { verifyStamp } from "@ttmc/core";
import { SIGNING_SECRETS } from "@/env";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify a disclosure" };

/**
 * The public verifier.
 *
 * Reachable with no account, because the person who most needs it is the
 * recipient of a message pasted into some other system — someone who has never
 * heard of TTMC and never will. A disclosure only the discloser can check is
 * not a disclosure.
 */
export default async function VerifyPage({
  params,
}: {
  params: Promise<{ stampId: string }>;
}) {
  const { stampId } = await params;
  const entry = await store.getStamp(stampId);

  if (!entry) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="label">Verification</p>
        <h1 className="mt-3 text-2xl font-semibold">No such stamp.</h1>
        <p className="mt-3 text-[var(--color-muted)]">
          Nothing here was signed with the id{" "}
          <code className="font-mono text-sm">{stampId}</code>. Either the link was
          mistyped, or the disclosure footer it came from was fabricated.
        </p>
      </div>
    );
  }

  const { stamp } = entry;
  const duel = await store.getDuel(entry.duelId);
  const turn = duel?.turns.find((t) => t.index === entry.turnIndex) ?? null;

  // Re-verify against the stored turn rather than trusting that it was valid
  // when written — this page has to answer "is it valid now, under the current
  // keys", which is a different question and the one that matters.
  const result = turn
    ? verifyStamp(stamp, turn.content, SIGNING_SECRETS)
    : { valid: false as const, failure: "malformed" as const };

  const shareable = duel && duel.visibility !== "private";

  return (
    <div className="mx-auto max-w-2xl">
      <p className="label">Verification</p>

      <h1
        className="mt-3 text-3xl font-semibold tracking-tight"
        style={{ color: result.valid ? "var(--color-good)" : "var(--color-danger)" }}
      >
        {result.valid ? "Genuine disclosure" : "Does not verify"}
      </h1>

      {result.valid ? (
        <p className="mt-3 text-[var(--color-muted)]">
          This message really was written by{" "}
          <strong className="text-[var(--color-text)]">
            {stamp.author === "agent" ? "an AI agent" : "a human"}
          </strong>
          , and the relay signed that claim at the time it was sent. The signature
          covers the exact wording, so the text has not been altered since.
        </p>
      ) : (
        <p className="mt-3 text-[var(--color-muted)]">
          The signature does not check out ({result.failure}). Do not treat the
          disclosure on this message as meaningful.
        </p>
      )}

      <dl className="panel mt-8 divide-y divide-[var(--color-edge)]">
        {[
          ["Author", stamp.author === "agent" ? "AI agent" : stamp.author],
          ["Model", stamp.model ?? "—"],
          [
            "Persona",
            stamp.persona ? `${stamp.persona.handle} v${stamp.persona.version}` : "—",
          ],
          ["Reviewed by a human", stamp.humanReviewed ? "Yes" : "No"],
          ["Signed at", stamp.ts],
          ["Turn", `${stamp.turnIndex} of exchange ${stamp.duelId}`],
          ["Signing key", result.valid ? (result.keyGeneration ?? "—") : "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-3">
            <dt className="label">{k}</dt>
            <dd className="text-right font-mono text-sm break-all">{v}</dd>
          </div>
        ))}
      </dl>

      {shareable && (
        <Link href={`/d/${duel.code}`} className="btn mt-6">
          Read the full exchange
        </Link>
      )}

      <p className="mt-8 text-xs leading-relaxed text-[var(--color-faint)]">
        Signatures are produced server-side, so a participant cannot forge one —
        including the forgery anyone would actually want, which is relabelling
        agent output as human-written. Absence of a stamp means the opposite of a
        failed one: it means nobody ever claimed anything.
      </p>
    </div>
  );
}
