import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type Redis from "ioredis";
import { AppException } from "../exceptions/app.exception";
import { REDIS } from "../../redis/redis.constants";

/** Releases the lock only if we still own it (it may have expired and been taken by someone else). */
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Short Redis locks so one person can't run the same money action twice at the same moment
 * (double-click on "Pay", two phones, a retry while the first request is still running).
 */
@Injectable()
export class LocksService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Runs `fn` while holding `key`; if someone already holds it, fails with 409 `busyCode`. */
  async withLock<T>(key: string, fn: () => Promise<T>, opts: { ttlMs?: number; busyMessage?: string; busyCode?: string } = {}): Promise<T> {
    const token = randomBytes(12).toString("hex");
    const ok = await this.redis.set(`lock:${key}`, token, "PX", opts.ttlMs ?? 60_000, "NX");
    if (ok !== "OK")
      throw new AppException(HttpStatus.CONFLICT, opts.busyCode ?? "REQUEST_IN_PROGRESS", opts.busyMessage ?? "We're still working on your last request. Please wait a moment.");
    try {
      return await fn();
    } finally {
      await this.redis.eval(RELEASE, 1, `lock:${key}`, token).catch(() => undefined);
    }
  }
}
