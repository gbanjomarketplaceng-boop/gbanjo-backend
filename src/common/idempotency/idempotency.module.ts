import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ResponseCacheInterceptor } from "../cache/response-cache.interceptor";
import { SessionCacheService } from "../cache/session-cache.service";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { LocksService } from "./locks.service";

/** Request-safety helpers shared by every module: idempotent retries, short per-person locks and the storefront cache. */
@Global()
@Module({
  providers: [LocksService, SessionCacheService, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }, { provide: APP_INTERCEPTOR, useClass: ResponseCacheInterceptor }],
  exports: [LocksService, SessionCacheService],
})
export class IdempotencyModule {}
