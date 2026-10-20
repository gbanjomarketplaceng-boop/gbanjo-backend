import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type Redis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "./redis.constants";

/** After Redis fails, use Postgres for this long before trying Redis again. */
const COOL_DOWN_MS = 15_000;
/** How often expired backup rows are removed. */
const CLEANUP_MS = 10 * 60_000;
/** Keys can live up to a day (idempotency), so check the backup table for that long after it was last used. */
const BACKUP_WINDOW_MS = 25 * 3600_000;

/**
 * Short-lived keys (locks, one-time codes, request keys, counters) with an automatic backup:
 * Redis is used normally; if Redis errors (down, over its plan's limit, out of memory, timing out),
 * the same operation runs against Postgres instead and Redis is retried a few seconds later.
 *
 * Keys written to Postgres during an outage are still found after Redis comes back (reads check both
 * for a day), so a code sent during an outage can still be used afterwards.
 *
 * Caches are different: `cache*` methods simply skip caching while Redis is unavailable (the data
 * comes straight from the database) — caching in the database would only add load.
 */
@Injectable()
export class KvService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Redis");
  private downUntil = 0;
  private outageLogged = false;
  /** Until when the backup table may hold live keys. */
  private backupLiveUntil = 0;
  private cleanup?: NodeJS.Timeout;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // Keys left in the backup table from an earlier outage (e.g. before a restart) are still honoured.
    const live = await this.prisma.kvEntry.findFirst({ where: { expiresAt: { gt: new Date() } }, select: { key: true } }).catch(() => null);
    if (live) this.backupLiveUntil = Date.now() + BACKUP_WINDOW_MS;
    this.cleanup = setInterval(() => void this.prisma.kvEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined), CLEANUP_MS);
    this.cleanup.unref();
  }

  onModuleDestroy() {
    if (this.cleanup) clearInterval(this.cleanup);
  }

  // ---------- Health ----------

  /** False while Redis is being skipped after a failure. */
  get redisUp() {
    return Date.now() >= this.downUntil;
  }

  /** For tests / admin tools: behave as if Redis failed for `ms`. */
  simulateOutage(ms: number) {
    this.downUntil = Date.now() + ms;
  }

  /** Report a Redis failure seen elsewhere (e.g. the job queue) so other features switch to the database too. */
  markDown(e: unknown) {
    this.trip(e);
  }

  private trip(e: unknown) {
    this.downUntil = Date.now() + COOL_DOWN_MS;
    if (!this.outageLogged) this.logger.error(`Redis unavailable (${(e as Error)?.message ?? e}). Using the database instead until it recovers.`);
    this.outageLogged = true;
  }

  private recovered() {
    if (this.outageLogged) this.logger.log("Redis is back. Switching back from the database.");
    this.outageLogged = false;
  }

  /** True when keys written to the database during an outage may still be live (check both stores). */
  get backupActive() {
    return this.checkBackup;
  }

  private get checkBackup() {
    return Date.now() < this.backupLiveUntil;
  }

  private touchedBackup() {
    this.backupLiveUntil = Date.now() + BACKUP_WINDOW_MS;
  }

  /**
   * Runs `onRedis`; if Redis is skipped or throws, runs `onDb` instead. Use for anything that must keep working.
   * Note: an error thrown by our own code inside `onRedis` also triggers the fallback, so keep `onRedis` to Redis calls.
   */
  async run<T>(onRedis: (r: Redis) => Promise<T>, onDb: () => Promise<T>): Promise<T> {
    if (this.redisUp) {
      try {
        const out = await onRedis(this.redis);
        this.recovered();
        return out;
      } catch (e) {
        this.trip(e);
      }
    }
    return onDb();
  }

  // ---------- Keys that must keep working (Redis → Postgres) ----------

  private readonly live = (key: string) => ({ key, expiresAt: { gt: new Date() } });
  private readonly at = (ms: number) => new Date(Date.now() + ms);

  private dbGet(key: string) {
    return this.prisma.kvEntry.findFirst({ where: this.live(key), select: { value: true } }).then((r) => r?.value ?? null);
  }

  async get(key: string): Promise<string | null> {
    return this.run(
      async (r) => (await r.get(key)) ?? (this.checkBackup ? await this.dbGet(key) : null),
      () => this.dbGet(key),
    );
  }

  /** Sets a key that expires after `ttlSeconds`. */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.run(
      async (r) => {
        await r.set(key, value, "EX", ttlSeconds);
      },
      async () => {
        const expiresAt = this.at(ttlSeconds * 1000);
        await this.prisma.kvEntry.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
        this.touchedBackup();
      },
    );
  }

  /** Sets the key only if nobody holds it (a lock / first claim). Returns true when we got it. */
  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    return this.run(
      async (r) => {
        // A key taken during an outage still counts as taken.
        if (this.checkBackup && (await this.dbGet(key)) !== null) return false;
        return (await r.set(key, value, "PX", ttlMs, "NX")) === "OK";
      },
      async () => {
        // Insert, or take over an expired row — atomically, so two requests can't both win.
        const rows = await this.prisma.$queryRaw<{ key: string }[]>`
          INSERT INTO kv_entries (key, value, expires_at) VALUES (${key}, ${value}, ${this.at(ttlMs)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
          WHERE kv_entries.expires_at <= now()
          RETURNING key`;
        this.touchedBackup();
        return rows.length === 1;
      },
    );
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.run(
      async (r) => {
        await r.del(...keys);
        if (this.checkBackup) await this.prisma.kvEntry.deleteMany({ where: { key: { in: keys } } });
      },
      async () => {
        await this.prisma.kvEntry.deleteMany({ where: { key: { in: keys } } });
      },
    );
  }

  /** Reads and deletes in one step (one-use tokens). */
  async getDel(key: string): Promise<string | null> {
    const fromDb = async () => {
      const rows = await this.prisma.$queryRaw<{ value: string }[]>`DELETE FROM kv_entries WHERE key = ${key} AND expires_at > now() RETURNING value`;
      return rows[0]?.value ?? null;
    };
    return this.run(async (r) => (await r.getdel(key)) ?? (this.checkBackup ? await fromDb() : null), fromDb);
  }

  /** Deletes the key only if it still holds `value` (releasing a lock we own). */
  async delIfValue(key: string, value: string): Promise<void> {
    const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
    await this.run(
      async (r) => {
        await r.eval(RELEASE, 1, key, value);
        if (this.checkBackup) await this.prisma.kvEntry.deleteMany({ where: { key, value } });
      },
      async () => {
        await this.prisma.kvEntry.deleteMany({ where: { key, value } });
      },
    );
  }

  /** Adds 1 and returns the new count; the counter expires `ttlSeconds` after the first increment. */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    return this.run(
      async (r) => {
        const INCR = `local n = redis.call("INCR", KEYS[1]) if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end return n`;
        return Number(await r.eval(INCR, 1, key, String(ttlSeconds)));
      },
      async () => {
        const rows = await this.prisma.$queryRaw<{ value: string }[]>`
          INSERT INTO kv_entries (key, value, expires_at) VALUES (${key}, '1', ${this.at(ttlSeconds * 1000)})
          ON CONFLICT (key) DO UPDATE SET
            value = CASE WHEN kv_entries.expires_at <= now() THEN '1' ELSE (kv_entries.value::int + 1)::text END,
            expires_at = CASE WHEN kv_entries.expires_at <= now() THEN EXCLUDED.expires_at ELSE kv_entries.expires_at END
          RETURNING value`;
        this.touchedBackup();
        return Number(rows[0].value);
      },
    );
  }

  /** Seconds until the key expires, or 0 when it doesn't exist. */
  async ttl(key: string): Promise<number> {
    const fromDb = async () => {
      const row = await this.prisma.kvEntry.findFirst({ where: this.live(key), select: { expiresAt: true } });
      return row ? Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000)) : 0;
    };
    return this.run(
      async (r) => {
        const t = await r.ttl(key);
        if (t > 0) return t;
        return this.checkBackup ? fromDb() : 0;
      },
      fromDb,
    );
  }

  /**
   * Postgres-side read-modify-write of one key, locked so parallel requests queue up (used for one-time codes).
   * `change` gets the current value (or null) and returns the new value (null deletes) plus a result.
   * The expiry is kept as it was.
   */
  async dbUpdate<T>(key: string, change: (current: string | null) => { value: string | null; result: T }): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ value: string }[]>`SELECT value FROM kv_entries WHERE key = ${key} AND expires_at > now() FOR UPDATE`;
      const { value, result } = change(rows[0]?.value ?? null);
      if (rows.length) {
        if (value === null) await tx.kvEntry.delete({ where: { key } });
        else await tx.kvEntry.update({ where: { key }, data: { value } });
      }
      return result;
    });
  }

  // ---------- Caches (skipped while Redis is unavailable) ----------

  async cacheGet(key: string): Promise<string | null> {
    if (!this.redisUp) return null;
    try {
      return await this.redis.get(key);
    } catch (e) {
      this.trip(e);
      return null;
    }
  }

  async cacheMget(...keys: string[]): Promise<(string | null)[]> {
    if (!this.redisUp) return keys.map(() => null);
    try {
      return await this.redis.mget(...keys);
    } catch (e) {
      this.trip(e);
      return keys.map(() => null);
    }
  }

  async cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.redisUp) return;
    await this.redis.set(key, value, "EX", ttlSeconds).catch((e: unknown) => this.trip(e));
  }

  async cacheDel(...keys: string[]): Promise<void> {
    if (!this.redisUp || !keys.length) return;
    await this.redis.del(...keys).catch((e: unknown) => this.trip(e));
  }

  /** Bumps a cache version counter. While Redis is out the caches are skipped anyway, so nothing is lost. */
  async cacheBump(key: string, ttlSeconds?: number): Promise<void> {
    if (!this.redisUp) return;
    const m = this.redis.multi().incr(key);
    if (ttlSeconds) m.expire(key, ttlSeconds);
    await m.exec().catch((e: unknown) => this.trip(e));
  }
}
