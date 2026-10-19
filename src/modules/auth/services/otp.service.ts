import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { AppException } from "../../../common/exceptions/app.exception";
import { randomDigits, sha256 } from "../../../common/utils/crypto";
import type { Env } from "../../../config/env.validation";
import { REDIS } from "../../../redis/redis.constants";
import type { OtpPurpose } from "../../notifications/notifications.constants";

interface OtpRecord {
  hash: string;
  attempts: number;
}

export interface IssuedOtp {
  code: string;
  codeLength: number;
  expiresIn: number;
  resendIn: number;
}

/**
 * One-time codes kept in Redis (never in Postgres). Only a keyed hash of the code is stored.
 * Enforces a resend cooldown, an hourly send cap and a wrong-attempt limit per code.
 */
/**
 * KEYS[1] = code record, KEYS[2] = resend cooldown; ARGV[1] = hash of the code entered, ARGV[2] = max attempts.
 * Hashes are fixed-length hex, so comparing them in Lua leaks nothing useful about the code.
 */
const VERIFY_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return {"expired", 0} end
local rec = cjson.decode(raw)
if rec.hash == ARGV[1] then
  redis.call("DEL", KEYS[1], KEYS[2])
  return {"ok", 0}
end
rec.attempts = (rec.attempts or 0) + 1
local max = tonumber(ARGV[2])
if rec.attempts >= max then
  redis.call("DEL", KEYS[1], KEYS[2])
  return {"locked", 0}
end
redis.call("SET", KEYS[1], cjson.encode(rec), "KEEPTTL")
return {"wrong", max - rec.attempts}
`;

@Injectable()
export class OtpService {
  private readonly length: number;
  private readonly ttl: number;
  private readonly maxAttempts: number;
  private readonly cooldown: number;
  private readonly maxSendsPerHour: number;
  private readonly devCode?: string;
  private readonly pepper: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.length = config.get("OTP_LENGTH", { infer: true });
    this.ttl = config.get("OTP_TTL_SECONDS", { infer: true });
    this.maxAttempts = config.get("OTP_MAX_ATTEMPTS", { infer: true });
    this.cooldown = config.get("OTP_RESEND_COOLDOWN_SECONDS", { infer: true });
    this.maxSendsPerHour = config.get("OTP_MAX_SENDS_PER_HOUR", { infer: true });
    this.devCode = config.get("OTP_DEV_CODE", { infer: true });
    this.pepper = config.get("JWT_ACCESS_SECRET", { infer: true });
  }

  get codeLength() {
    return this.length;
  }

  get resendCooldown() {
    return this.cooldown;
  }

  private keys(purpose: OtpPurpose, subject: string) {
    return {
      code: `otp:${purpose}:${subject}`,
      cooldown: `otp:cooldown:${purpose}:${subject}`,
      sends: `otp:sends:${purpose}:${subject}`,
    };
  }

  private hash(subject: string, code: string) {
    return sha256(`${this.pepper}:${subject}:${code}`);
  }

  /** Creates a new code (replacing any previous one). Throws OTP_COOLDOWN / OTP_LIMIT_REACHED when asked too often. */
  async issue(purpose: OtpPurpose, subject: string): Promise<IssuedOtp> {
    const k = this.keys(purpose, subject);

    const wait = await this.redis.ttl(k.cooldown);
    if (wait > 0)
      throw new AppException(HttpStatus.TOO_MANY_REQUESTS, "OTP_COOLDOWN", `Please wait ${wait} seconds before requesting another code.`, {
        retryAfter: wait,
      });

    const sends = await this.redis.incr(k.sends);
    if (sends === 1) await this.redis.expire(k.sends, 3600);
    if (sends > this.maxSendsPerHour) {
      const retryAfter = Math.max(await this.redis.ttl(k.sends), 1);
      throw new AppException(HttpStatus.TOO_MANY_REQUESTS, "OTP_LIMIT_REACHED", "Too many codes requested. Try again later.", { retryAfter });
    }

    const code = this.devCode ?? randomDigits(this.length);
    const record: OtpRecord = { hash: this.hash(subject, code), attempts: 0 };
    const tx = this.redis.multi().set(k.code, JSON.stringify(record), "EX", this.ttl);
    if (this.cooldown > 0) tx.set(k.cooldown, "1", "EX", this.cooldown);
    await tx.exec();

    return { code, codeLength: this.length, expiresIn: this.ttl, resendIn: this.cooldown };
  }

  /**
   * Checks and consumes a code. Throws CODE_EXPIRED, INVALID_CODE (with attemptsRemaining) or TOO_MANY_ATTEMPTS.
   * Runs as one Redis script so parallel guesses can't get extra attempts and a right code can only be used once.
   */
  async verify(purpose: OtpPurpose, subject: string, code: string): Promise<void> {
    const k = this.keys(purpose, subject);
    const result = (await this.redis.eval(VERIFY_SCRIPT, 2, k.code, k.cooldown, this.hash(subject, code), String(this.maxAttempts))) as [string, number];
    const [outcome, left] = result;
    if (outcome === "ok") return;
    if (outcome === "expired") throw new AppException(HttpStatus.BAD_REQUEST, "CODE_EXPIRED", "This code has expired. Request a new one.");
    if (outcome === "locked") throw new AppException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS", "Too many wrong codes. Request a new code.");
    throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_CODE", "That code isn't right. Check it and try again.", { attemptsRemaining: Number(left) });
  }
}
