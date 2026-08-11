import { NextResponse } from "next/server";
import { RelayError } from "@/server/relay";

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export const UNAUTHORIZED = () =>
  error(
    "Not authenticated. Send a bearer token from /settings/connect, or sign in.",
    401,
  );

/**
 * Wraps a handler so RelayError carries its own status and anything unexpected
 * becomes a 500 without leaking a stack trace to the caller.
 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RelayError) return error(err.message, err.status);
    console.error("[ttmc] unhandled route error:", err);
    return error("Something broke on our side.", 500);
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new RelayError("Request body must be valid JSON.", 400);
  }
}
