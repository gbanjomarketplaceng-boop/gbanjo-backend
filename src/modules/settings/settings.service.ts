import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";

/** Business settings an admin can change without a redeploy. Each falls back to the .env value. */
export interface BusinessSettings {
  /** Gbanjo's commission on each delivered sale (% of the items). */
  platformFeePercent: number;
  /** Express delivery fee in naira (standard delivery is free). */
  expressShippingFee: number;
  /** Days a seller's earnings are held after delivery before they can be withdrawn. */
  payoutHoldDays: number;
  /** Smallest withdrawal (₦). */
  withdrawalMin: number;
  /** Withdrawals above this (₦) wait for a finance admin to approve them. 0 = never. */
  withdrawalApprovalAbove: number;
}

export const SETTING_LIMITS: Record<keyof BusinessSettings, { min: number; max: number }> = {
  platformFeePercent: { min: 0, max: 50 },
  expressShippingFee: { min: 0, max: 1_000_000 },
  payoutHoldDays: { min: 0, max: 60 },
  withdrawalMin: { min: 100, max: 10_000_000 },
  withdrawalApprovalAbove: { min: 0, max: 1_000_000_000 },
};

// Tests reset the database between cases, so they read settings fresh every time.
const CACHE_MS = process.env.NODE_ENV === "test" ? 0 : 15_000;

@Injectable()
export class SettingsService {
  private cache?: { at: number; value: BusinessSettings };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  defaults(): BusinessSettings {
    const get = <K extends keyof Env>(k: K) => this.config.get(k, { infer: true });
    return {
      platformFeePercent: get("PLATFORM_FEE_PERCENT"),
      expressShippingFee: get("SHIPPING_EXPRESS_FEE"),
      payoutHoldDays: get("ORDER_PAYOUT_HOLD_DAYS"),
      withdrawalMin: get("WITHDRAWAL_MIN"),
      withdrawalApprovalAbove: 0,
    };
  }

  /** Current settings (cached for a few seconds; changes made here clear the cache at once). */
  async get(): Promise<BusinessSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const value = this.defaults();
    const rows = await this.prisma.setting.findMany();
    for (const r of rows) if (r.key in value && typeof r.value === "number") (value as unknown as Record<string, number>)[r.key] = r.value;
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(patch: Partial<BusinessSettings>, adminId: string): Promise<BusinessSettings> {
    const entries = Object.entries(patch).filter(([k, v]) => k in SETTING_LIMITS && typeof v === "number");
    await this.prisma.$transaction(entries.map(([key, value]) => this.prisma.setting.upsert({ where: { key }, create: { key, value: value as number, updatedBy: adminId }, update: { value: value as number, updatedBy: adminId } })));
    this.cache = undefined;
    return this.get();
  }
}
