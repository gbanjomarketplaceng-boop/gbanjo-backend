import { Global, Inject, Logger, Module, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import type { Env } from "../config/env.validation";
import { redisOptions } from "../config/redis-options";
import { REDIS } from "./redis.constants";

/** Shared Redis client for caching, OTPs, rate limits, etc. (BullMQ opens its own connections.) */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const logger = new Logger("Redis");
        const client = new Redis(redisOptions(config));
        // ioredis reconnects on its own; log instead of crashing on "Unhandled error event".
        client.on("error", (err) => logger.error(err.message));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
