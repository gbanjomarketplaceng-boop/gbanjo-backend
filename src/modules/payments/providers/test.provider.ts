import type Redis from "ioredis";
import type { InitializePayment, PaymentProvider, VerifiedPayment } from "./payment-provider";

const key = (reference: string) => `testpay:${reference}`;

/**
 * Stand-in for Flutterwave when FLW_SECRET_KEY isn't set (never in production). The "payment page" is
 * GET /payments/test-checkout/:reference on this API, with Pay / Fail / Cancel buttons.
 */
export class TestPaymentProvider implements PaymentProvider {
  readonly name = "test";

  constructor(
    private readonly redis: Redis,
    private readonly apiBase: string,
  ) {}

  async initialize(p: InitializePayment) {
    await this.redis.set(key(p.reference), JSON.stringify({ amount: p.amount, currency: p.currency, redirectUrl: p.redirectUrl, status: "pending" }), "EX", 86_400);
    return { checkoutUrl: `${this.apiBase}/payments/test-checkout/${encodeURIComponent(p.reference)}` };
  }

  /** What the test checkout page knows about a payment (null when unknown). */
  async session(reference: string): Promise<{ amount: number; currency: string; redirectUrl: string; status: string } | null> {
    const raw = await this.redis.get(key(reference));
    return raw ? JSON.parse(raw) : null;
  }

  /** Called by the test checkout buttons. */
  async complete(reference: string, status: "successful" | "failed" | "cancelled") {
    const s = await this.session(reference);
    if (!s) return null;
    await this.redis.set(key(reference), JSON.stringify({ ...s, status }), "EX", 86_400);
    return { ...s, status, transactionId: `test-${reference}` };
  }

  async verify(reference: string): Promise<VerifiedPayment | null> {
    const s = await this.session(reference);
    if (!s || s.status === "pending") return null;
    return { transactionId: `test-${reference}`, reference, status: s.status, amount: s.amount, currency: s.currency };
  }

  async refund() {
    /* nothing to call */
  }
}
