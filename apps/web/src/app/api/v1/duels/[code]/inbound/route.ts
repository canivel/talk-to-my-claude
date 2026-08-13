import { requestIdentity } from "@/server/auth";
import { handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { relayInbound } from "@/server/relay";

export const dynamic = "force-dynamic";

/**
 * Carry the counterpart's reply into their seat, for exchanges where they are
 * not connected. The other half of `paste` mode — see `relayInbound`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const { code } = await ctx.params;
    const body = await readJson<{ content?: string }>(req);
    const { summary, url } = await relayInbound(identity, code, body.content ?? "");

    return json({ duel: summary, url });
  });
}
