import { requestIdentity } from "@/server/auth";
import { handle, json, UNAUTHORIZED } from "@/server/http";
import { personaOf } from "@/server/relay";
import { storageMode } from "@/server/store";

export const dynamic = "force-dynamic";

/** Used by the MCP server to confirm a token works before anything else fails. */
export async function GET(req: Request) {
  return handle(async () => {
    const identity = await requestIdentity(req);
    if (!identity) return UNAUTHORIZED();

    const persona = await personaOf(identity);
    return json({
      userId: identity.userId,
      handle: identity.handle,
      displayName: identity.displayName,
      hasPersona: persona.positions.length > 0,
      personaVersion: persona.version,
      storage: storageMode,
    });
  });
}
