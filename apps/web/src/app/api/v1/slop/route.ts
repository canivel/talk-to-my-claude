import { scoreSlop } from "@ttmc/core";
import { error, handle, json, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

/** Deliberately unauthenticated: the scorer is the free demo and the hook. */
export async function POST(req: Request) {
  return handle(async () => {
    const { text } = await readJson<{ text?: string }>(req);
    if (typeof text !== "string") return error("Send { text: string }.", 400);
    if (text.length > 50_000) return error("Message too long — 50,000 characters max.", 413);
    return json(scoreSlop(text));
  });
}
