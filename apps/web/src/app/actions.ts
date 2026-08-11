"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessionIdentity } from "@/server/auth";
import { escalateExchange, openExchange, postTurn, RelayError } from "@/server/relay";
import { store } from "@/server/store";

async function requireIdentity() {
  const identity = await sessionIdentity();
  if (!identity) throw new RelayError("Sign in first.", 401);
  return identity;
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createExchangeAction(form: FormData) {
  const identity = await requireIdentity();

  const inbound = str(form, "inboundMessage");
  if (!inbound) throw new RelayError("Paste the message you received.", 400);

  const { duel } = await openExchange(identity, {
    // Derived rather than demanded: one fewer field between the user and the
    // thing they came here to do.
    subject: str(form, "subject") || inbound.split("\n")[0]!.slice(0, 70) || "Untitled",
    inboundMessage: inbound,
    counterpartName: str(form, "counterpartName") || undefined,
    maxTurns: Number(str(form, "maxTurns")) || undefined,
    visibility: str(form, "visibility") === "unlisted" ? "unlisted" : "private",
  });

  redirect(`/d/${duel.code}`);
}

export async function submitReplyAction(form: FormData) {
  const identity = await requireIdentity();
  const code = str(form, "code");

  await postTurn(identity, code, {
    content: str(form, "content"),
    author: str(form, "author") === "human" ? "human" : "agent",
    model: str(form, "model") || undefined,
  });

  revalidatePath(`/d/${code}`);
}

export async function escalateAction(form: FormData) {
  const identity = await requireIdentity();
  const code = str(form, "code");
  await escalateExchange(identity, code, str(form, "reason"));
  revalidatePath(`/d/${code}`);
}

export async function mintTokenAction(form: FormData) {
  const identity = await requireIdentity();
  const { token } = await store.createToken(identity.userId, str(form, "label") || "MCP");
  // Returned once and never again — only the hash is stored.
  redirect(`/settings/connect?token=${encodeURIComponent(token)}`);
}
