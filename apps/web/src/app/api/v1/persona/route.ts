import type { Authority, Persona } from "@ttmc/core";
import { renderPersonaBrief } from "@ttmc/core";
import { requestAuth } from "@/server/auth";
import { error, handle, json, readJson, UNAUTHORIZED } from "@/server/http";
import { personaOf, savePersona } from "@/server/relay";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requestAuth(req);
    if (!auth) return UNAUTHORIZED();

    const persona = await personaOf(auth.identity);
    return json({ persona, brief: renderPersonaBrief(persona) });
  });
}

interface PersonaBody {
  role?: string;
  tone?: string;
  positions?: string[];
  boundaries?: string[];
  escalateOn?: string[];
  authority?: Partial<Authority>;
}

function changesAuthority(current: Persona, patch: Partial<Authority>): boolean {
  return (Object.keys(patch) as Array<keyof Authority>).some(
    (k) => patch[k] !== undefined && patch[k] !== current.authority[k],
  );
}

/**
 * Update the persona.
 *
 * Authority ceilings are **session-only**. An agent holding a bearer token can
 * refine what it says — positions, voice, boundaries — but it cannot widen the
 * limits it is checked against. Allowing that would let an agent blocked by the
 * escalation gate raise its own money ceiling and retry, which turns the gate
 * from a control into a suggestion. Ceilings are set by a human at a keyboard.
 */
export async function PUT(req: Request) {
  return handle(async () => {
    const auth = await requestAuth(req);
    if (!auth) return UNAUTHORIZED();

    const body = await readJson<PersonaBody>(req);
    const current = await personaOf(auth.identity);

    if (body.authority && auth.via === "token") {
      if (changesAuthority(current, body.authority)) {
        return error(
          "Authority ceilings cannot be changed with an API token. An agent does not get " +
            "to widen the limits it is checked against — set them in the browser at /settings/persona.",
          403,
        );
      }
    }

    const { persona, problems, changed } = await savePersona(auth.identity, {
      role: body.role ?? current.role,
      tone: body.tone ?? current.tone,
      positions: body.positions ?? current.positions,
      boundaries: body.boundaries ?? current.boundaries,
      escalateOn: body.escalateOn ?? current.escalateOn,
      authority: { ...current.authority, ...(body.authority ?? {}) },
    });

    return json({ persona, problems, changed, brief: renderPersonaBrief(persona) });
  });
}
