import { requestIdentity } from "@/server/auth";
import { handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { postTurn, type PostTurnInput } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const { code } = await ctx.params;
    const body = await readJson<PostTurnInput>(req);
    const result = await postTurn(identity, code, {
      content: body.content ?? "",
      model: body.model,
      humanReviewed: body.humanReviewed,
      confidence: body.confidence,
    });

    return json({
      turn: result.turn,
      duel: {
        id: result.duel.id,
        code: result.duel.code,
        status: result.duel.status,
        turnOf: result.duel.turnOf,
      },
      delivered: result.delivered,
      escalations: result.escalations,
      disclosedText: result.disclosedText,
      url: result.url,
    });
  });
}
