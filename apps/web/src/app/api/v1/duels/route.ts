import { requestIdentity } from "@/server/auth";
import { handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { listExchanges, openExchange, type OpenInput } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const awaitingMe = new URL(req.url).searchParams.get("awaiting") === "me";
    return json({ duels: await listExchanges(identity, { awaitingMe }) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const body = await readJson<OpenInput>(req);
    const { summary, brief } = await openExchange(identity, {
      subject: body.subject ?? "",
      inboundMessage: body.inboundMessage,
      counterpartName: body.counterpartName,
      maxTurns: body.maxTurns,
      visibility: body.visibility,
    });
    return json({ duel: summary, brief }, 201);
  });
}
