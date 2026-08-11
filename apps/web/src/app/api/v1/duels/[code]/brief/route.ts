import { requestIdentity } from "@/server/auth";
import { handle, json, UNAUTHORIZED } from "@/server/http";
import { getBrief } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const { code } = await ctx.params;
    return json(await getBrief(identity, code));
  });
}
