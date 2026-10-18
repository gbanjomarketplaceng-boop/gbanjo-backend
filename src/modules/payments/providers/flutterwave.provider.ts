import { HttpStatus, Logger } from "@nestjs/common";
import { AppException } from "../../../common/exceptions/app.exception";
import type { Bank, InitializePayment, PaymentProvider, TransferRequest, TransferResult, VerifiedPayment } from "./payment-provider";

/** Flutterwave transfer statuses → ours. */
export const transferState = (s: string): TransferResult["status"] => {
  const v = String(s).toUpperCase();
  return v === "SUCCESSFUL" ? "successful" : v === "FAILED" ? "failed" : "pending";
};

/** Our method names → Flutterwave's payment_options. */
const OPTIONS: Record<string, string> = {
  card: "card",
  "bank-transfer": "banktransfer",
  ussd: "ussd",
};

interface FlwResponse<T> {
  status: "success" | "error";
  message: string;
  data: T;
}

interface FlwTransaction {
  id: number;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
}

/**
 * Flutterwave Standard (v3): we create a hosted payment link, the shopper pays there and is sent back,
 * and we always confirm the result with Flutterwave's verify endpoint before giving value.
 * Docs: https://developer.flutterwave.com/docs/collecting-payments/standard
 */
export class FlutterwaveProvider implements PaymentProvider {
  readonly name = "flutterwave";
  private readonly logger = new Logger("Flutterwave");

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
  ) {}

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<FlwResponse<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      this.logger.error(`${path}: ${(e as Error).message}`);
      throw new AppException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR", "We couldn't reach the payment service. Please try again.");
    }
    const json = (await res.json().catch(() => null)) as FlwResponse<T> | null;
    if (!json) throw new AppException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR", "The payment service sent an unexpected reply. Please try again.");
    return json;
  }

  async initialize(p: InitializePayment) {
    const res = await this.call<{ link: string }>("/payments", {
      method: "POST",
      body: {
        tx_ref: p.reference,
        amount: p.amount,
        currency: p.currency,
        redirect_url: p.redirectUrl,
        customer: { email: p.customer.email, name: p.customer.name, ...(p.customer.phone ? { phonenumber: p.customer.phone } : {}) },
        customizations: { title: p.title, description: p.description },
        ...(p.method && OPTIONS[p.method] ? { payment_options: OPTIONS[p.method] } : {}),
        meta: p.meta,
      },
    });
    if (res.status !== "success" || !res.data?.link) {
      this.logger.error(`initialize ${p.reference}: ${res.message}`);
      throw new AppException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR", "We couldn't start the payment. Please try again.");
    }
    return { checkoutUrl: res.data.link };
  }

  async verify(reference: string, transactionId?: string): Promise<VerifiedPayment | null> {
    const res = transactionId
      ? await this.call<FlwTransaction>(`/transactions/${encodeURIComponent(transactionId)}/verify`)
      : await this.call<FlwTransaction>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    if (res.status !== "success" || !res.data) return null; // e.g. "No transaction was found for this id"
    const t = res.data;
    return { transactionId: String(t.id), reference: t.tx_ref, status: String(t.status).toLowerCase(), amount: Number(t.amount), currency: t.currency };
  }

  async refund(transactionId: string, amount: number) {
    const res = await this.call<unknown>(`/transactions/${encodeURIComponent(transactionId)}/refund`, { method: "POST", body: { amount } });
    if (res.status !== "success") throw new Error(res.message || "Refund refused");
  }

  async banks(): Promise<Bank[]> {
    const res = await this.call<{ code: string; name: string }[]>("/banks/NG");
    if (res.status !== "success" || !Array.isArray(res.data)) throw new AppException(HttpStatus.BAD_GATEWAY, "PAYMENT_PROVIDER_ERROR", "We couldn't load the list of banks. Please try again.");
    return res.data.map((b) => ({ code: String(b.code), name: b.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const res = await this.call<{ account_name?: string }>("/accounts/resolve", { method: "POST", body: { account_number: accountNumber, account_bank: bankCode } });
    return res.status === "success" && res.data?.account_name ? res.data.account_name : null;
  }

  async transfer(t: TransferRequest): Promise<TransferResult> {
    const res = await this.call<{ id: number; status: string; complete_message?: string }>("/transfers", {
      method: "POST",
      body: { account_bank: t.bankCode, account_number: t.accountNumber, amount: t.amount, narration: t.narration, currency: "NGN", debit_currency: "NGN", reference: t.reference },
    });
    if (res.status !== "success" || !res.data?.id) {
      this.logger.error(`transfer ${t.reference}: ${res.message}`);
      return { transferId: "", status: "failed", message: res.message || "The transfer was refused" };
    }
    return { transferId: String(res.data.id), status: transferState(res.data.status), message: res.data.complete_message };
  }

  async transferStatus(transferId: string): Promise<TransferResult> {
    const res = await this.call<{ id: number; status: string; complete_message?: string }>(`/transfers/${encodeURIComponent(transferId)}`);
    if (res.status !== "success" || !res.data) return { transferId, status: "pending" };
    return { transferId, status: transferState(res.data.status), message: res.data.complete_message };
  }
}
