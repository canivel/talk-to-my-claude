import { requestIdentity } from "@/server/auth";
import { handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { joinExchange } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const { code } = await ctx.params;
    // A bodyless join is legitimate — the default mode is the common case.
    const body = await readJson<{ mode?: "mcp" | "byok" | "human" }>(req).catch(
      () => ({}) as { mode?: "mcp" | "byok" | "human" },
    );
    const { summary, brief } = await joinExchange(identity, code, body.mode ?? "mcp");
    return json({ duel: summary, brief });
  });
}
