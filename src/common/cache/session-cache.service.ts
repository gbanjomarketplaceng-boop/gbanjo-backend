import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../../redis/redis.constants";

export interface CachedSession {
  userId: string;
  role: "USER" | "ADMIN";
  status: string;
  revoked: boolean;
  expiresAt: number;
}

const TTL_SECONDS = 15;
const sessKey = (sid: string) => `sess:${sid}`;
const userKey = (userId: string) => `sess:uv:${userId}`;

/**
 * Keeps "is this session still live?" in Redis for a few seconds so signed-in requests don't each wait
 * on the database. Logging out, password changes, suspensions and deletions clear it straight away.
 */
@Injectable()
export class SessionCacheService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get(sid: string, userId: string): Promise<CachedSession | null> {
    try {
      const [raw, version] = await this.redis.mget(sessKey(sid), userKey(userId));
      if (!raw) return null;
      const entry = JSON.parse(raw) as CachedSession & { v: string };
      return entry.v === (version ?? "0") ? entry : null;
    } catch {
      return null;
    }
  }

  async set(sid: string, s: CachedSession): Promise<void> {
    try {
      const version = (await this.redis.get(userKey(s.userId))) ?? "0";
      await this.redis.set(sessKey(sid), JSON.stringify({ ...s, v: version }), "EX", TTL_SECONDS);
    } catch {
      /* cache is optional */
    }
  }

  /** One session ended (logout, token reuse). */
  async dropSession(sid: string): Promise<void> {
    await this.redis.del(sessKey(sid)).catch(() => undefined);
  }

  /** Everything about this person changed (all sessions revoked, suspended, deleted, role changed). */
  async dropUser(userId: string): Promise<void> {
    await this.redis.multi().incr(userKey(userId)).expire(userKey(userId), 30 * 86_400).exec().catch(() => undefined);
  }
}
