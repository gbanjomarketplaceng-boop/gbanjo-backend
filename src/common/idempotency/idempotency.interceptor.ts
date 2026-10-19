import { CallHandler, ExecutionContext, HttpStatus, Inject, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import type Redis from "ioredis";
import { createHash } from "node:crypto";
import { from, Observable, of, switchMap } from "rxjs";
import { AppException } from "../exceptions/app.exception";
import { REDIS } from "../../redis/redis.constants";

export const IDEMPOTENT = "idempotent";
/**
 * Marks a POST route as safe to retry: when the client sends an `Idempotency-Key` header, the first
 * response is saved for 24 hours and any repeat with the same key gets that same response back
 * instead of doing the work again. A repeat that arrives while the first is still running gets 409.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const DONE_TTL = 24 * 3600;
const RUNNING_TTL = 120;

type Saved = { state: "running"; fp: string } | { state: "done"; fp: string; status: number; body: unknown };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== "http" || !this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = req.header("idempotency-key");
    if (!header) return next.handle();
    if (!KEY_RE.test(header)) throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–100 letters, digits, - or _.");

    // Keys are per person and per route; the body fingerprint stops a key being reused for a different request.
    const who = req.user?.id ?? req.ip ?? "anon";
    const key = `idem:${who}:${req.method}:${req.route?.path ?? req.path}:${header}`;
    const fp = createHash("sha256").update(JSON.stringify(req.body ?? {})).digest("hex");

    return from(this.claim(key, fp)).pipe(
      switchMap((saved) => {
        if (saved) {
          if (saved.fp !== fp)
            throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, "IDEMPOTENCY_KEY_REUSED", "This request key was already used for a different request.");
          if (saved.state === "running") throw new AppException(HttpStatus.CONFLICT, "REQUEST_IN_PROGRESS", "We're still working on your last request. Please wait a moment.");
          res.status(saved.status);
          res.setHeader("Idempotent-Replayed", "true");
          return of(saved.body);
        }
        return next.handle().pipe(
          switchMap(async (body) => {
            await this.redis.set(key, JSON.stringify({ state: "done", fp, status: res.statusCode, body } satisfies Saved), "EX", DONE_TTL);
            return body;
          }),
          // Failed requests may be retried with the same key.
          (src) =>
            new Observable((sub) =>
              src.subscribe({
                next: (v) => sub.next(v),
                complete: () => sub.complete(),
                error: (e) => {
                  void this.redis.del(key).catch(() => undefined);
                  sub.error(e);
                },
              }),
            ),
        );
      }),
    );
  }

  /** Returns null when we got the key (first request); otherwise what's saved under it. */
  private async claim(key: string, fp: string): Promise<Saved | null> {
    const ok = await this.redis.set(key, JSON.stringify({ state: "running", fp } satisfies Saved), "EX", RUNNING_TTL, "NX");
    if (ok === "OK") return null;
    const raw = await this.redis.get(key);
    if (!raw) return this.claim(key, fp);
    return JSON.parse(raw) as Saved;
  }
}
