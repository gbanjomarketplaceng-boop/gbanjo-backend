import { ConfigService } from "@nestjs/config";
import type { RedisOptions } from "ioredis";
import type { Env } from "./env.validation";

/** redis://user:pass@host:6379/2 (or rediss:// for TLS) → ioredis options. */
export function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url);
  const db = Number(u.pathname.replace("/", ""));
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.username && u.username !== "default" ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(Number.isInteger(db) && db > 0 ? { db } : {}),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

/** Shared Redis connection settings for the app client and BullMQ. REDIS_URL wins over the REDIS_* parts. */
export const redisOptions = (config: ConfigService<Env, true>): RedisOptions => {
  const url = config.get("REDIS_URL", { infer: true });
  if (url) return { ...parseRedisUrl(url), ...(process.env.REDIS_DB ? { db: config.get("REDIS_DB", { infer: true }) } : {}) };
  return {
    host: config.get("REDIS_HOST", { infer: true }),
    port: config.get("REDIS_PORT", { infer: true }),
    password: config.get("REDIS_PASSWORD", { infer: true }) || undefined,
    db: config.get("REDIS_DB", { infer: true }),
  };
};
