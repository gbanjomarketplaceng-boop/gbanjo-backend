import type Redis from "ioredis";
import type { Bank, InitializePayment, PaymentProvider, TransferRequest, TransferResult, VerifiedPayment } from "./payment-provider";

const TEST_BANKS: Bank[] = [
  { code: "044", name: "Access Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "50211", name: "Kuda Bank" },
  { code: "999992", name: "OPay" },
  { code: "999991", name: "PalmPay" },
  { code: "033", name: "United Bank for Africa" },
  { code: "057", name: "Zenith Bank" },
];

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

  async banks() {
    return TEST_BANKS;
  }

  /** Any 10-digit number resolves to a test name; numbers ending 9999 don't exist. */
  async resolveAccount(_bankCode: string, accountNumber: string) {
    return /^\d{10}$/.test(accountNumber) && !accountNumber.endsWith("9999") ? `TEST ACCOUNT ${accountNumber.slice(-4)}` : null;
  }

  /** Transfers succeed at once, except to accounts ending 0000 (to try the failure path). */
  async transfer(t: TransferRequest): Promise<TransferResult> {
    return t.accountNumber.endsWith("0000")
      ? { transferId: `test-${t.reference}`, status: "failed", message: "Test: the bank rejected this account" }
      : { transferId: `test-${t.reference}`, status: "successful" };
  }

  async transferStatus(transferId: string): Promise<TransferResult> {
    return { transferId, status: "pending" };
  }
}
