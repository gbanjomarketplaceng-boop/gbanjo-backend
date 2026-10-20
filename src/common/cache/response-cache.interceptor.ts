import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { from, Observable, of, switchMap, tap } from "rxjs";
import { KvService } from "../../redis/kv.service";

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
  constructor(
    private readonly reflector: Reflector,
    private readonly kv: KvService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== "http") return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    if (req.method !== "GET") {
      if (!BUSTING_PATHS.some((re) => re.test(req.path))) return next.handle();
      return next.handle().pipe(tap(() => void this.kv.cacheBump(VERSION_KEY)));
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
            if (key && res.statusCode === 200) void this.kv.cacheSet(key, JSON.stringify(body), seconds);
          }),
        );
      }),
    );
  }

  /** Never lets a Redis problem break the page: while Redis is unavailable the cache is simply skipped. */
  private async lookup(url: string): Promise<{ key: string | null; hit: string | null }> {
    if (!this.kv.redisUp) return { key: null, hit: null };
    const version = (await this.kv.cacheGet(VERSION_KEY)) ?? "0";
    const key = `cache:storefront:${version}:${url}`;
    return { key, hit: await this.kv.cacheGet(key) };
  }
}
