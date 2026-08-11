import type { Metadata } from "next";
import Link from "next/link";
import { HAS_CLERK, PUBLIC_URL, configWarnings } from "@/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_URL),
  title: {
    default: "Talk To My Claude",
    template: "%s · Talk To My Claude",
  },
  description:
    "You sent me AI. Here's my AI. A disclosure-first relay that lets two agents settle it, then hands the humans back only what they need to decide.",
  openGraph: {
    title: "Talk To My Claude",
    description:
      "Stop being the copy-paste layer between two language models. Let the agents talk — signed, disclosed, and compressed into what actually needs a human.",
    type: "website",
  },
};

function Warnings() {
  const warnings = configWarnings();
  if (warnings.length === 0) return null;
  return (
    <div className="border-b border-[var(--color-danger)] bg-[#2a0f0e] px-5 py-2 text-sm">
      {warnings.map((w) => (
        <p key={w}>
          <span className="font-mono text-[var(--color-danger)]">MISCONFIGURED</span> {w}
        </p>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Warnings />
        <header className="border-b border-[var(--color-edge)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
            <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
              talk<span className="text-[var(--color-faint)]">-to-my-</span>
              <span className="text-[var(--color-seat-a)]">claude</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm text-[var(--color-muted)]">
              <Link href="/app" className="hover:text-[var(--color-text)]">
                Exchanges
              </Link>
              <Link href="/app/metrics" className="hover:text-[var(--color-text)]">
                Metrics
              </Link>
              <Link href="/settings/persona" className="hover:text-[var(--color-text)]">
                Persona
              </Link>
              <Link href="/settings/connect" className="hover:text-[var(--color-text)]">
                Connect
              </Link>
              <Link
                href="/new"
                className="btn btn-primary !px-3 !py-1.5 !text-[0.8125rem]"
              >
                New
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-10">{children}</main>
        <footer className="mt-16 border-t border-[var(--color-edge)] px-5 py-8">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-faint)]">
            <p>
              Every agent-written message here is signed and disclosed. That is the
              whole point.
            </p>
            <a
              href="https://github.com/canivel/talk-to-my-claude"
              className="hover:text-[var(--color-muted)]"
            >
              github.com/canivel/talk-to-my-claude
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!HAS_CLERK) return <Shell>{children}</Shell>;

  const { ClerkProvider } = await import("@clerk/nextjs");
  return (
    <ClerkProvider>
      <Shell>{children}</Shell>
    </ClerkProvider>
  );
}
