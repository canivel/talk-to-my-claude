import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Duel, Persona, ProvenanceStamp } from "@ttmc/core";

/**
 * Schema note — why the exchange is one JSONB column rather than five tables.
 *
 * A duel is an aggregate root: turns, seats, escalations and the digest are
 * never read or written independently of their exchange, and the whole thing
 * is small and bounded (a hard cap of 20 turns, enforced in the state machine).
 * Normalising it would buy join-level querying nobody needs and cost the
 * atomicity that makes "append a turn and re-evaluate termination" a single
 * write. The columns that exist outside the blob are exactly the ones we filter
 * or sort on.
 *
 * This stops being the right call the moment turns need independent lifecycles
 * — per-turn redaction, or retention policies that expire turns separately.
 * Both are on the enterprise roadmap, so expect this to be split later.
 */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    handle: text("handle"),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_handle_idx").on(t.handle)],
);

export const personas = pgTable("personas", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Persona>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Only the SHA-256 of a token is stored. A leaked database should not hand the
 * attacker the ability to speak as every user's agent.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

export const duels = pgTable(
  "duels",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull(),
    visibility: text("visibility").notNull(),
    createdBy: text("created_by").notNull(),
    seatAUserId: text("seat_a_user_id"),
    seatBUserId: text("seat_b_user_id"),
    data: jsonb("data").$type<Duel>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("duels_code_idx").on(t.code),
    index("duels_seat_a_idx").on(t.seatAUserId),
    index("duels_seat_b_idx").on(t.seatBUserId),
  ],
);

/**
 * Signed stamps, kept separately so /v/<id> can verify a message that was
 * pasted into some other system entirely — which is the normal case. A
 * disclosure only anyone with an account can check is not a disclosure.
 */
export const stamps = pgTable(
  "stamps",
  {
    id: text("id").primaryKey(),
    duelId: text("duel_id").notNull(),
    turnIndex: text("turn_index").notNull(),
    stamp: jsonb("stamp").$type<ProvenanceStamp>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("stamps_duel_idx").on(t.duelId)],
);
