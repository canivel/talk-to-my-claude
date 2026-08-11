import type { NextResponse } from "next/server";
import { requestAuth, type Identity } from "@/server/auth";
import { error, handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Token management is **session-only**, deliberately.
 *
 * An agent holding a token must not be able to mint more of them, or to
 * enumerate and revoke its siblings. A stolen token should grant exactly what
 * that one token was scoped to and no ability to bootstrap further access.
 */
type SessionCheck =
  | { fail: NextResponse; identity?: undefined }
  | { fail?: undefined; identity: Identity };

async function requireSession(req: Request): Promise<SessionCheck> {
  const auth = await requestAuth(req);
  if (!auth) return { fail: UNAUTHORIZED() };
  if (auth.via === "token") {
    return {
      fail: error(
        "Token management requires a signed-in browser session. An API token cannot mint or revoke tokens.",
        403,
      ),
    };
  }
  return { identity: auth.identity };
}

export async function GET(req: Request) {
  return handle(async () => {
    const { fail, identity } = await requireSession(req);
    if (fail) return fail;

    const tokens = await store.listTokens(identity.userId);
    // Never echo the token itself — only a hash of it is stored anyway.
    return json({
      tokens: tokens.map((t) => ({
        label: t.label,
        createdAt: t.createdAt,
        fingerprint: t.tokenHash.slice(-8),
      })),
    });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const { fail, identity } = await requireSession(req);
    if (fail) return fail;

    const body = await readJson<{ label?: string }>(req).catch(() => ({}) as { label?: string });
    const { token, record } = await store.createToken(
      identity.userId,
      body.label?.trim() || "API",
    );

    // Returned exactly once. Only the hash is persisted.
    return json({ token, label: record.label, createdAt: record.createdAt }, 201);
  });
}
