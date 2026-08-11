import { requestIdentity } from "@/server/auth";
import { handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { escalateExchange } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const { code } = await ctx.params;
    const body = await readJson<{ reason?: string }>(req);
    const { escalation, url } = await escalateExchange(identity, code, body.reason ?? "");
    return json({ escalation, url });
  });
}
