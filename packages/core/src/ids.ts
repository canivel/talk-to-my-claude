import { randomBytes } from "node:crypto";

/** Unambiguous alphabet: no 0/O/1/I/l, so codes survive being read aloud. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** Rejection sampling keeps the distribution uniform across the alphabet. */
function randomString(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function newId(prefix: string, length = 20): string {
  return `${prefix}_${randomString(length)}`;
}

export const newDuelId = () => newId("duel");
export const newTurnId = () => newId("turn");
export const newEscalationId = () => newId("esc");
export const newTokenId = () => newId("ttmc", 32);

/** Short, shareable, guessable-resistant enough for unlisted transcripts. */
export const newDuelCode = () => randomString(10);

export function nowIso(): string {
  return new Date().toISOString();
}
