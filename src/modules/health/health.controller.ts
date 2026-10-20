import { Controller, Get, Inject, ServiceUnavailableException, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import Redis from "ioredis";
import { Public } from "../../common/decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";
import { REDIS } from "../../redis/redis.constants";

@ApiTags("Health")
@Public()
@SkipThrottle()
@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** GET /api/health — checks Postgres and Redis. Unhealthy only when the database is down. */
  @Get()
  @ApiOperation({ summary: "Liveness check for Postgres and Redis" })
  @ApiOkResponse({ schema: { example: { status: "ok", database: "up", redis: "up" } }, description: 'redis "fallback" = Redis is unavailable and the database is covering for it (still healthy)' })
  @ApiServiceUnavailableResponse()
  async check() {
    const [db, cache] = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
    const status = {
      database: db.status === "fulfilled" ? "up" : "down",
      // The API keeps working without Redis (the database covers for it), so only the database decides health.
      redis: cache.status === "fulfilled" ? "up" : "fallback",
    };
    if (status.database === "down") throw new ServiceUnavailableException({ status: "error", ...status });
    return { status: "ok", ...status };
  }
}
