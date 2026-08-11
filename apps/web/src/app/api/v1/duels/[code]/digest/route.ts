import type { DigestDraft } from "@ttmc/core";
import { requestIdentity } from "@/server/auth";
import { handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { submitDigest } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const { code } = await ctx.params;
    const body = await readJson<{ draft?: DigestDraft } & DigestDraft>(req);
    // The MCP tool sends the draft fields flat; accept either shape.
    const draft = body.draft ?? body;

    const result = await submitDigest(identity, code, draft);
    return json({
      digest: result.duel.digest,
      markdown: result.markdown,
      problems: result.problems,
      url: result.url,
    });
  });
}
