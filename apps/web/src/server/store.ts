/**
 * Storage. One interface, two adapters.
 *
 * The in-memory adapter is not a test double — it is the default runtime when
 * DATABASE_URL is unset, so `pnpm dev` works on a fresh clone with no services.
 * Keeping both behind one interface means the demo path and the production path
 * exercise identical calling code.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import type { Duel, Persona, ProvenanceStamp } from "@ttmc/core";
import { newTokenId } from "@ttmc/core";
import { DATABASE_URL, HAS_DATABASE } from "@/env";
import { apiTokens, duels, personas, stamps, users } from "@/db/schema";

export interface UserRecord {
  id: string;
  handle: string | null;
  displayName: string;
}

export interface TokenRecord {
  tokenHash: string;
  userId: string;
  label: string;
  createdAt: string;
}

export interface StoredStamp {
  id: string;
  duelId: string;
  turnIndex: number;
  stamp: ProvenanceStamp;
}

export interface Store {
  upsertUser(user: UserRecord): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;

  getPersona(userId: string): Promise<Persona | null>;
  savePersona(userId: string, persona: Persona): Promise<void>;

  createToken(userId: string, label: string): Promise<{ token: string; record: TokenRecord }>;
  resolveToken(token: string): Promise<string | null>;
  listTokens(userId: string): Promise<TokenRecord[]>;
  revokeToken(userId: string, tokenHash: string): Promise<void>;

  saveDuel(duel: Duel): Promise<void>;
  getDuel(id: string): Promise<Duel | null>;
  getDuelByCode(code: string): Promise<Duel | null>;
  listDuelsForUser(userId: string): Promise<Duel[]>;

  saveStamp(entry: StoredStamp): Promise<void>;
  getStamp(id: string): Promise<StoredStamp | null>;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ─── In-memory ──────────────────────────────────────────────────────────────

class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private personas = new Map<string, Persona>();
  private tokens = new Map<string, TokenRecord>();
  private duels = new Map<string, Duel>();
  private byCode = new Map<string, string>();
  private stamps = new Map<string, StoredStamp>();

  async upsertUser(user: UserRecord): Promise<UserRecord> {
    const existing = this.users.get(user.id);
    const merged = { ...existing, ...user };
    this.users.set(user.id, merged);
    return merged;
  }

  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }

  async getPersona(userId: string) {
    return this.personas.get(userId) ?? null;
  }

  async savePersona(userId: string, persona: Persona) {
    this.personas.set(userId, persona);
  }

  async createToken(userId: string, label: string) {
    const token = newTokenId();
    const record: TokenRecord = {
      tokenHash: hashToken(token),
      userId,
      label,
      createdAt: new Date().toISOString(),
    };
    this.tokens.set(record.tokenHash, record);
    return { token, record };
  }

  async resolveToken(token: string) {
    return this.tokens.get(hashToken(token))?.userId ?? null;
  }

  async listTokens(userId: string) {
    return [...this.tokens.values()].filter((t) => t.userId === userId);
  }

  async revokeToken(userId: string, tokenHash: string) {
    const t = this.tokens.get(tokenHash);
    if (t?.userId === userId) this.tokens.delete(tokenHash);
  }

  async saveDuel(duel: Duel) {
    // Structured-clone on write so callers holding a reference cannot mutate
    // stored state, matching what the Postgres adapter does for free.
    this.duels.set(duel.id, structuredClone(duel));
    this.byCode.set(duel.code, duel.id);
  }

  async getDuel(id: string) {
    const d = this.duels.get(id);
    return d ? structuredClone(d) : null;
  }

  async getDuelByCode(code: string) {
    const id = this.byCode.get(code);
    return id ? this.getDuel(id) : null;
  }

  async listDuelsForUser(userId: string) {
    return [...this.duels.values()]
      .filter((d) => d.seats.A.userId === userId || d.seats.B.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((d) => structuredClone(d));
  }

  async saveStamp(entry: StoredStamp) {
    this.stamps.set(entry.id, entry);
  }

  async getStamp(id: string) {
    return this.stamps.get(id) ?? null;
  }
}

// ─── Postgres ───────────────────────────────────────────────────────────────

type Db = Awaited<ReturnType<typeof connect>>;

async function connect() {
  const [{ drizzle }, postgres] = await Promise.all([
    import("drizzle-orm/postgres-js"),
    import("postgres"),
  ]);
  const sql = postgres.default(DATABASE_URL, { max: 5 });
  return drizzle(sql, { schema: { users, personas, apiTokens, duels, stamps } });
}

class PostgresStore implements Store {
  private dbPromise: Promise<Db> | null = null;

  private db(): Promise<Db> {
    this.dbPromise ??= connect();
    return this.dbPromise;
  }

  async upsertUser(user: UserRecord): Promise<UserRecord> {
    const db = await this.db();
    await db
      .insert(users)
      .values(user)
      .onConflictDoUpdate({
        target: users.id,
        set: { handle: user.handle, displayName: user.displayName },
      });
    return user;
  }

  async getUser(id: string) {
    const db = await this.db();
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? { id: row.id, handle: row.handle, displayName: row.displayName } : null;
  }

  async getPersona(userId: string) {
    const db = await this.db();
    const [row] = await db
      .select()
      .from(personas)
      .where(eq(personas.userId, userId))
      .limit(1);
    return row?.data ?? null;
  }

  async savePersona(userId: string, persona: Persona) {
    const db = await this.db();
    await db
      .insert(personas)
      .values({ userId, data: persona, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: personas.userId,
        set: { data: persona, updatedAt: new Date() },
      });
  }

  async createToken(userId: string, label: string) {
    const db = await this.db();
    const token = newTokenId();
    const tokenHash = hashToken(token);
    await db.insert(apiTokens).values({ tokenHash, userId, label });
    return {
      token,
      record: { tokenHash, userId, label, createdAt: new Date().toISOString() },
    };
  }

  async resolveToken(token: string) {
    const db = await this.db();
    const hash = hashToken(token);
    const [row] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, hash))
      .limit(1);
    if (!row || row.revokedAt) return null;
    // Fire-and-forget: a failed last-used update must never fail the request.
    void db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.tokenHash, hash))
      .catch(() => {});
    return row.userId;
  }

  async listTokens(userId: string) {
    const db = await this.db();
    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));
    return rows
      .filter((r) => !r.revokedAt)
      .map((r) => ({
        tokenHash: r.tokenHash,
        userId: r.userId,
        label: r.label,
        createdAt: r.createdAt.toISOString(),
      }));
  }

  async revokeToken(userId: string, tokenHash: string) {
    const db = await this.db();
    await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.tokenHash, tokenHash), eq(apiTokens.userId, userId)));
  }

  async saveDuel(duel: Duel) {
    const db = await this.db();
    const row = {
      id: duel.id,
      code: duel.code,
      subject: duel.subject,
      status: duel.status,
      visibility: duel.visibility,
      createdBy: duel.createdBy,
      seatAUserId: duel.seats.A.userId,
      seatBUserId: duel.seats.B.userId,
      data: duel,
      updatedAt: new Date(duel.updatedAt),
    };
    await db
      .insert(duels)
      .values(row)
      .onConflictDoUpdate({ target: duels.id, set: row });
  }

  async getDuel(id: string) {
    const db = await this.db();
    const [row] = await db.select().from(duels).where(eq(duels.id, id)).limit(1);
    return row?.data ?? null;
  }

  async getDuelByCode(code: string) {
    const db = await this.db();
    const [row] = await db.select().from(duels).where(eq(duels.code, code)).limit(1);
    return row?.data ?? null;
  }

  async listDuelsForUser(userId: string) {
    const db = await this.db();
    const rows = await db
      .select()
      .from(duels)
      .where(or(eq(duels.seatAUserId, userId), eq(duels.seatBUserId, userId)))
      .orderBy(desc(duels.updatedAt))
      .limit(100);
    return rows.map((r) => r.data);
  }

  async saveStamp(entry: StoredStamp) {
    const db = await this.db();
    await db
      .insert(stamps)
      .values({
        id: entry.id,
        duelId: entry.duelId,
        turnIndex: String(entry.turnIndex),
        stamp: entry.stamp,
      })
      .onConflictDoNothing();
  }

  async getStamp(id: string) {
    const db = await this.db();
    const [row] = await db.select().from(stamps).where(eq(stamps.id, id)).limit(1);
    return row
      ? {
          id: row.id,
          duelId: row.duelId,
          turnIndex: Number(row.turnIndex),
          stamp: row.stamp,
        }
      : null;
  }
}

/**
 * Held on globalThis so Next's dev-server module reloading does not drop the
 * in-memory dataset (or open a new connection pool) on every edit.
 */
const globalForStore = globalThis as unknown as { __ttmcStore?: Store };

export const store: Store =
  globalForStore.__ttmcStore ??
  (globalForStore.__ttmcStore = HAS_DATABASE ? new PostgresStore() : new MemoryStore());

export const storageMode = HAS_DATABASE ? "postgres" : "memory";
