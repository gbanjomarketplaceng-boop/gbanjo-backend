import { HttpStatus, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AppException } from "../exceptions/app.exception";
import { KvService } from "../../redis/kv.service";

/**
 * Short locks so one person can't run the same money action twice at the same moment
 * (double-click on "Pay", two phones, a retry while the first request is still running).
 * Held in Redis, or in the database while Redis is unavailable.
 */
@Injectable()
export class LocksService {
  constructor(private readonly kv: KvService) {}

  /** Runs `fn` while holding `key`; if someone already holds it, fails with 409 `busyCode`. */
  async withLock<T>(key: string, fn: () => Promise<T>, opts: { ttlMs?: number; busyMessage?: string; busyCode?: string } = {}): Promise<T> {
    const token = randomBytes(12).toString("hex");
    const ok = await this.kv.setIfAbsent(`lock:${key}`, token, opts.ttlMs ?? 60_000);
    if (!ok)
      throw new AppException(HttpStatus.CONFLICT, opts.busyCode ?? "REQUEST_IN_PROGRESS", opts.busyMessage ?? "We're still working on your last request. Please wait a moment.");
    try {
      return await fn();
    } finally {
      // Only releases it if we still own it (it may have expired and been taken by someone else).
      await this.kv.delIfValue(`lock:${key}`, token).catch(() => undefined);
    }
  }
}
