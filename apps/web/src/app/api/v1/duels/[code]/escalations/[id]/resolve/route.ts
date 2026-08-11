import { requestAuth } from "@/server/auth";
import { error, handle, json, UNAUTHORIZED } from "@/server/http";
import { resolveExchangeEscalation, summarize } from "@/server/relay";

export const dynamic = "force-dynamic";

/**
 * Clear an escalation and hand the turn back.
 *
 * **Session-only, and this is the single most important authorization rule in
 * the codebase.** If an agent could resolve the escalation it just triggered,
 * the gate would stop being a control and become a speed bump — trip it,
 * dismiss it, retry. Resolving is an act of human judgement, so it requires a
 * human session. The relay additionally enforces that only the seat that raised
 * it may clear it.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string; id: string }> },
) {
  return handle(async () => {
    const auth = await requestAuth(req);
    if (!auth) return UNAUTHORIZED();
    if (auth.via === "token") {
      return error(
        "An agent cannot resolve its own escalation. That is the whole point of the gate — " +
          "a human has to decide, signed in at /d/<code>.",
        403,
      );
    }

    const { code, id } = await ctx.params;
    const { duel, url } = await resolveExchangeEscalation(auth.identity, code, id);

    return json({ duel: summarize(duel, auth.identity.userId), url });
  });
}
