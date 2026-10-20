import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { type ThrottlerStorage, ThrottlerStorageService } from "@nestjs/throttler";
import type Redis from "ioredis";
import type { KvService } from "../../redis/kv.service";

type Record_ = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

/**
 * Rate-limit counters in Redis (shared by every API instance). If Redis is unavailable or over its limit,
 * counting continues in this server's memory instead of failing every request, and moves back to
 * Redis by itself once it recovers.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly redisStore: ThrottlerStorageRedisService;
  private readonly memory = new ThrottlerStorageService();

  constructor(
    redis: Redis,
    private readonly kv: KvService,
  ) {
    this.redisStore = new ThrottlerStorageRedisService(redis);
  }

  increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<Record_> {
    return this.kv.run(
      () => this.redisStore.increment(key, ttl, limit, blockDuration, throttlerName),
      () => this.memory.increment(key, ttl, limit, blockDuration, throttlerName),
    );
  }

  onApplicationShutdown() {
    this.memory.onApplicationShutdown();
  }
}
