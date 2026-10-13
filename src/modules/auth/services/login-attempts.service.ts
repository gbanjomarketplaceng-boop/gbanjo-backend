import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { AppException } from "../../../common/exceptions/app.exception";
import type { Env } from "../../../config/env.validation";
import { REDIS } from "../../../redis/redis.constants";

/** Locks an email for LOGIN_LOCK_MINUTES after LOGIN_MAX_ATTEMPTS wrong passwords (brute-force protection). */
@Injectable()
export class LoginAttemptsService {
  private readonly max: number;
  private readonly lockSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.max = config.get("LOGIN_MAX_ATTEMPTS", { infer: true });
    this.lockSeconds = config.get("LOGIN_LOCK_MINUTES", { infer: true }) * 60;
  }

  async assertNotLocked(email: string) {
    const wait = await this.redis.ttl(`login:lock:${email}`);
    if (wait > 0)
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        "ACCOUNT_LOCKED",
        `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""} or reset your password.`,
        { retryAfter: wait },
      );
  }

  /** Records a failure and returns how many attempts are left (0 = now locked). */
  async recordFailure(email: string): Promise<number> {
    const key = `login:fail:${email}`;
    const fails = await this.redis.incr(key);
    if (fails === 1) await this.redis.expire(key, this.lockSeconds);
    if (fails >= this.max) {
      await this.redis.multi().set(`login:lock:${email}`, "1", "EX", this.lockSeconds).del(key).exec();
      return 0;
    }
    return this.max - fails;
  }

  async clear(email: string) {
    await this.redis.del(`login:fail:${email}`, `login:lock:${email}`);
  }
}
