import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import Redis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.constants";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** GET /api/health — checks Postgres and Redis. */
  @Get()
  async check() {
    const [db, cache] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
    const status = {
      database: db.status === "fulfilled" ? "up" : "down",
      redis: cache.status === "fulfilled" ? "up" : "down",
    };
    if (status.database === "down" || status.redis === "down") throw new ServiceUnavailableException({ status: "error", ...status });
    return { status: "ok", ...status };
  }
}
