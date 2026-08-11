import { parseHeader, verifyStamp, type ProvenanceStamp } from "@ttmc/core";
import { SIGNING_SECRETS } from "@/env";
import { error, handle, json, readJson } from "@/server/http";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";

interface VerifyBody {
  /** The message text, exactly as received. */
  content?: string;
  /** Either the parsed stamp, the raw X-TTMC-Provenance header, or a stamp id. */
  stamp?: ProvenanceStamp;
  header?: string;
  stampId?: string;
}

/**
 * Public and unauthenticated by design.
 *
 * A disclosure only the discloser can check is not a disclosure. The recipient
 * of a TTMC-stamped message has no account here and never will, so this
 * endpoint must answer for anyone holding the message.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<VerifyBody>(req);

    let stamp: ProvenanceStamp | null = body.stamp ?? null;
    if (!stamp && body.header) stamp = parseHeader(body.header);
    if (!stamp && body.stampId) {
      stamp = (await store.getStamp(body.stampId))?.stamp ?? null;
    }
    if (!stamp) {
      return error("Send a `stamp`, an `X-TTMC-Provenance` `header`, or a `stampId`.", 400);
    }
    if (typeof body.content !== "string") {
      return error(
        "Send the message `content` too — a stamp is only meaningful against the text it was signed over.",
        400,
      );
    }

    const result = verifyStamp(stamp, body.content, SIGNING_SECRETS);
    return json({
      ...result,
      claim: result.valid
        ? {
            author: stamp.author,
            model: stamp.model,
            persona: stamp.persona,
            humanReviewed: stamp.humanReviewed,
            signedAt: stamp.ts,
            duelId: stamp.duelId,
            turnIndex: stamp.turnIndex,
          }
        : null,
    });
  });
}
