/**
 * Identity resolution.
 *
 * Two callers with different credentials converge on one `Identity`:
 *   - the browser, authenticated by a Clerk session
 *   - the MCP server, authenticated by a bearer token
 *
 * Plus a third mode that matters more than it looks: with no Clerk keys set,
 * the app runs as a single local demo user. That is what lets someone clone the
 * repo and see the product in one command. It is refused in production.
 */

import type { Persona } from "@ttmc/core";
import { createPersona } from "@ttmc/core";
import { HAS_CLERK, IS_PRODUCTION } from "@/env";
import { store } from "@/server/store";

export interface Identity {
  userId: string;
  handle: string | null;
  displayName: string;
}

export const DEV_IDENTITY: Identity = {
  userId: "user_local_demo",
  handle: "demo",
  displayName: "Demo User",
};

/** Identity from a Clerk session, or the demo user when Clerk is not configured. */
export async function sessionIdentity(): Promise<Identity | null> {
  if (!HAS_CLERK) {
    if (IS_PRODUCTION) return null;
    return ensureUser(DEV_IDENTITY);
  }

  const { currentUser } = await import("@clerk/nextjs/server");
  const user = await currentUser();
  if (!user) return null;

  const displayName =
    user.fullName ??
    user.firstName ??
    user.username ??
    user.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "Someone";

  return ensureUser({
    userId: user.id,
    handle: user.username ?? null,
    displayName,
  });
}

/**
 * How a request authenticated. `token` means an agent is calling; `session`
 * means a human is at a keyboard. Some operations legitimately care which.
 */
export type AuthSource = "token" | "session";

export interface AuthedRequest {
  identity: Identity;
  via: AuthSource;
}

/**
 * Identity for API routes. A bearer token wins over a session cookie, because
 * the MCP server is the caller that always presents one and we do not want an
 * incidental browser session changing who a tool call runs as.
 */
export async function requestAuth(req: Request): Promise<AuthedRequest | null> {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    const userId = token ? await store.resolveToken(token) : null;
    if (!userId) return null;
    const record = await store.getUser(userId);
    return record
      ? {
          identity: {
            userId: record.id,
            handle: record.handle,
            displayName: record.displayName,
          },
          via: "token",
        }
      : null;
  }
  const identity = await sessionIdentity();
  return identity ? { identity, via: "session" } : null;
}

export async function requestIdentity(req: Request): Promise<Identity | null> {
  return (await requestAuth(req))?.identity ?? null;
}

async function ensureUser(identity: Identity): Promise<Identity> {
  await store.upsertUser({
    id: identity.userId,
    handle: identity.handle,
    displayName: identity.displayName,
  });
  return identity;
}

/**
 * A persona always exists, because an agent with no persona improvises — and an
 * improvising agent speaking in your name is the failure mode this product is
 * supposed to prevent. The default is maximally restrictive: it can explain and
 * disagree, and it can promise nothing.
 */
export async function personaFor(identity: Identity): Promise<Persona> {
  const existing = await store.getPersona(identity.userId);
  if (existing) return existing;

  const persona = createPersona({
    handle: identity.handle ?? identity.userId.slice(-8),
    displayName: identity.displayName,
    role: "",
    positions: [
      "I have not written my standing positions yet, so my agent cannot assert anything on my behalf.",
    ],
    boundaries: ["Never agree to anything. Ask me first."],
  });
  await store.savePersona(identity.userId, persona);
  return persona;
}
