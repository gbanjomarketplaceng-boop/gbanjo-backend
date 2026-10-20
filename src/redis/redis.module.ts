import { Global, Inject, Logger, Module, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { Env } from "../config/env.validation";
import { redisOptions } from "../config/redis-options";
import { KvService } from "./kv.service";
import { REDIS } from "./redis.constants";

/** Shared Redis client + KvService (Redis with automatic database backup). BullMQ opens its own connections. */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const logger = new Logger("Redis");
        const client = new Redis({
          ...redisOptions(config),
          // Fail fast instead of making requests wait while Redis is down or over its limit:
          // KvService then uses the database, caches are skipped. (BullMQ has its own connections.)
          maxRetriesPerRequest: 1,
          commandTimeout: 2500,
          connectTimeout: 5000,
        });
        // ioredis reconnects on its own; log (at most once a minute) instead of crashing on "Unhandled error event".
        let lastLog = 0;
        client.on("error", (err) => {
          if (Date.now() - lastLog < 60_000) return;
          lastLog = Date.now();
          logger.error(err.message);
        });
        return client;
      },
    },
    KvService,
  ],
  exports: [REDIS, KvService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    // quit() waits for Redis; if it isn't connected (outage), just drop the connection so shutdown doesn't hang.
    if (this.redis.status !== "ready") return this.redis.disconnect();
    await Promise.race([this.redis.quit(), new Promise((r) => setTimeout(r, 2000))]).catch(() => undefined);
    this.redis.disconnect();
  }
}
