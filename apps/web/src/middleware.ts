import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { HAS_CLERK } from "@/env";

/**
 * Clerk is optional. With no keys configured the app runs on a single local
 * demo identity, so middleware becomes a pass-through and a fresh clone boots
 * with `pnpm dev` and nothing else.
 */
async function clerkHandler() {
  const { clerkMiddleware } = await import("@clerk/nextjs/server");
  return clerkMiddleware();
}

let cached: Promise<Awaited<ReturnType<typeof clerkHandler>>> | null = null;

export default async function middleware(req: NextRequest, event: never) {
  if (!HAS_CLERK) return NextResponse.next();
  cached ??= clerkHandler();
  const handler = await cached;
  return handler(req, event);
}

export const config = {
  matcher: [
    // Everything except static assets, plus all API routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)",
    "/(api|trpc)(.*)",
  ],
};
