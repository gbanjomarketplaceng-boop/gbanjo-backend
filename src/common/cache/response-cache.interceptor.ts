import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import type Redis from "ioredis";
import { from, Observable, of, switchMap, tap } from "rxjs";
import { REDIS } from "../../redis/redis.constants";

export const CACHE_FOR = "cacheFor";
/**
 * Caches a public GET's JSON in Redis for `seconds` (keyed by the full URL). Any successful change to
 * listings, reviews or banners clears every cached storefront page at once (see BUSTING_PATHS), so
 * shoppers never wait long to see an update even without waiting for the timeout.
 */
export const CacheFor = (seconds: number) => SetMetadata(CACHE_FOR, seconds);

const VERSION_KEY = "cache:storefront:v";
/** Writes to these routes change what the storefront shows. */
const BUSTING_PATHS = [/\/seller\//, /\/admin\//, /\/products\/[^/]+\/reviews/, /\/reviews\//, /\/users\/me$/];

@Injectable()
export class ResponseCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger("ResponseCache");

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== "http") return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    if (req.method !== "GET") {
      if (!BUSTING_PATHS.some((re) => re.test(req.path))) return next.handle();
      return next.handle().pipe(tap(() => void this.redis.incr(VERSION_KEY).catch(() => undefined)));
    }

    const seconds = this.reflector.getAllAndOverride<number | undefined>(CACHE_FOR, [ctx.getHandler(), ctx.getClass()]);
    if (!seconds) return next.handle();

    return from(this.lookup(req.originalUrl)).pipe(
      switchMap(({ key, hit }) => {
        res.setHeader("Cache-Control", `public, max-age=${seconds}`);
        if (hit !== null) {
          res.setHeader("X-Cache", "HIT");
          return of(JSON.parse(hit) as unknown);
        }
        res.setHeader("X-Cache", "MISS");
        return next.handle().pipe(
          tap((body) => {
            if (key && res.statusCode === 200) void this.redis.set(key, JSON.stringify(body), "EX", seconds).catch(() => undefined);
          }),
        );
      }),
    );
  }

  /** Never lets a Redis hiccup break the page: on any error we just skip the cache. */
  private async lookup(url: string): Promise<{ key: string | null; hit: string | null }> {
    try {
      const version = (await this.redis.get(VERSION_KEY)) ?? "0";
      const key = `cache:storefront:${version}:${url}`;
      return { key, hit: await this.redis.get(key) };
    } catch (e) {
      this.logger.warn(`skipping cache: ${(e as Error).message}`);
      return { key: null, hit: null };
    }
  }
}
