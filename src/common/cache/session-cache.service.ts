import { Injectable } from "@nestjs/common";
import { KvService } from "../../redis/kv.service";

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
  constructor(private readonly kv: KvService) {}

  async get(sid: string, userId: string): Promise<CachedSession | null> {
    // While Redis is unavailable this returns null and the database is asked instead.
    const [raw, version] = await this.kv.cacheMget(sessKey(sid), userKey(userId));
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as CachedSession & { v: string };
      return entry.v === (version ?? "0") ? entry : null;
    } catch {
      return null;
    }
  }

  async set(sid: string, s: CachedSession): Promise<void> {
    const version = (await this.kv.cacheGet(userKey(s.userId))) ?? "0";
    await this.kv.cacheSet(sessKey(sid), JSON.stringify({ ...s, v: version }), TTL_SECONDS);
  }

  /** One session ended (logout, token reuse). */
  async dropSession(sid: string): Promise<void> {
    await this.kv.cacheDel(sessKey(sid));
  }

  /** Everything about this person changed (all sessions revoked, suspended, deleted, role changed). */
  async dropUser(userId: string): Promise<void> {
    // If Redis is down this is skipped, but so is the cache: Redis is only tried again after the
    // cached sessions (15 s) have expired, so nobody keeps a stale "still allowed" answer.
    await this.kv.cacheBump(userKey(userId), 30 * 86_400);
  }
}
