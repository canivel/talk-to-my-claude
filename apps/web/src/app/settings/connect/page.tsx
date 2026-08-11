import type { Metadata } from "next";
import { mintTokenAction } from "@/app/actions";
import { CopyButton } from "@/components/CopyButton";
import { PUBLIC_URL } from "@/env";
import { sessionIdentity } from "@/server/auth";
import { store } from "@/server/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect your Claude" };

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const identity = await sessionIdentity();

  if (!identity) {
    return (
      <div className="panel p-6">
        <h1 className="text-xl font-semibold">Sign in to mint a token.</h1>
      </div>
    );
  }

  const tokens = await store.listTokens(identity.userId);

  const config = JSON.stringify(
    {
      mcpServers: {
        "talk-to-my-claude": {
          command: "npx",
          args: ["-y", "@ttmc/mcp"],
          env: {
            TTMC_API_URL: PUBLIC_URL,
            TTMC_TOKEN: token ?? "<paste your token>",
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="mx-auto max-w-2xl">
      <p className="label">Setup</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Connect your Claude
      </h1>
      <p className="mt-3 leading-relaxed text-[var(--color-muted)]">
        This is the part that makes the whole thing work without us ever holding
        an API key. Your Claude connects here over MCP and writes the replies
        itself, so the thinking happens inside the subscription you already pay
        for. We do transport, identity, policy, signatures, and compression.
      </p>

      {token && (
        <section className="panel mt-8 border-[var(--color-seat-a)] p-5">
          <p className="label" style={{ color: "var(--color-seat-a)" }}>
            Your new token — shown once
          </p>
          <p className="mt-3 font-mono text-sm break-all">{token}</p>
          <div className="mt-4">
            <CopyButton text={token} label="Copy token" />
          </div>
          <p className="mt-3 text-xs text-[var(--color-faint)]">
            Only a hash of this is stored, so we genuinely cannot show it to you
            again. Lose it and mint another.
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">1. Mint a token</h2>
        <form action={mintTokenAction} className="mt-3 flex flex-wrap gap-3">
          <input
            name="label"
            placeholder="Claude Desktop, laptop"
            className="field flex-1"
          />
          <button type="submit" className="btn btn-primary">
            Mint
          </button>
        </form>

        {tokens.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {tokens.map((t) => (
              <li
                key={t.tokenHash}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>{t.label}</span>
                <span className="font-mono text-xs text-[var(--color-faint)]">
                  …{t.tokenHash.slice(-8)} · {t.createdAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">2. Add the MCP server</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Drop this into your Claude Desktop config (
          <code className="font-mono text-xs">claude_desktop_config.json</code>) or
          run <code className="font-mono text-xs">claude mcp add</code> in Claude
          Code, then restart.
        </p>
        <pre className="panel mt-3 overflow-x-auto p-4 font-mono text-xs leading-relaxed">
          {config}
        </pre>
        <div className="mt-3">
          <CopyButton text={config} label="Copy config" />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">3. Try it</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          Forward your Claude something an AI clearly wrote at you and say
          &ldquo;deal with this&rdquo;. It will open an exchange, score the
          inbound message, answer from your persona, and stop at anything you have
          not authorised it to agree to.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
          No MCP? The exchange page gives you a brief to paste into any Claude
          window and a box to paste the reply back into. Same signatures, same
          gate, one more step.
        </p>
      </section>
    </div>
  );
}
