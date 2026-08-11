/**
 * Environment resolution, in one place.
 *
 * The design rule this file enforces: the app must boot and be fully usable
 * with an empty .env. A public repo whose demo requires a Postgres instance and
 * a Clerk account before it shows you anything gets cloned and abandoned.
 */

export const PUBLIC_URL = (
  process.env.TTMC_PUBLIC_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
  "http://localhost:3000"
).replace(/\/+$/, "");

const DEV_SECRET = "dev-only-insecure-secret-change-me";

export const SIGNING_SECRET = process.env.TTMC_SIGNING_SECRET || DEV_SECRET;

/** Current key first. Retired keys still verify, so rotation is not a cliff. */
export const SIGNING_SECRETS: string[] = [
  SIGNING_SECRET,
  ...(process.env.TTMC_SIGNING_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const HAS_DATABASE = DATABASE_URL.length > 0;

export const HAS_CLERK = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Deployment warnings, surfaced in the UI rather than only in logs. A demo
 * secret in production would silently make every disclosure signature
 * forgeable, which is the one failure this project cannot ship with.
 */
export function configWarnings(): string[] {
  const out: string[] = [];
  if (IS_PRODUCTION && SIGNING_SECRET === DEV_SECRET) {
    out.push(
      "TTMC_SIGNING_SECRET is still the default. Every provenance signature is forgeable until you set it.",
    );
  }
  if (IS_PRODUCTION && !HAS_DATABASE) {
    out.push("DATABASE_URL is unset — running in memory. All exchanges are lost on restart.");
  }
  if (IS_PRODUCTION && !HAS_CLERK) {
    out.push("Clerk is not configured — everyone shares one demo identity.");
  }
  return out;
}
