import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type Redis from "ioredis";
import type { Payment, PaymentPurpose, Prisma } from "../../generated/prisma/client";
import { AppException } from "../../common/exceptions/app.exception";
import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { REDIS } from "../../redis/redis.constants";
import { InboxService } from "../inbox/inbox.service";
import { NotificationsService } from "../notifications/notifications.service";
import { WalletService } from "../wallet/wallet.service";
import type { PaymentDto, TopUpDto } from "./dto/payments.dto";
import { FlutterwaveProvider } from "./providers/flutterwave.provider";
import type { PaymentProvider } from "./providers/payment-provider";
import { TestPaymentProvider } from "./providers/test.provider";

type Tx = Prisma.TransactionClient;
/** Runs inside the same database transaction that marks the payment paid (give value here). */
type PaidHandler = (tx: Tx, payment: Payment) => Promise<void>;
/** Runs after that transaction commits (send notifications here). */
type AfterPaidHandler = (payment: Payment) => Promise<void>;

/** Custom app schemes allowed as return links (production app, Expo Go / dev builds). */
const APP_SCHEMES = new Set(["gbanjo:", "exp:", "exps:"]);
/** Card payments left unpaid this long are marked canceled. */
const EXPIRE_AFTER_MS = 48 * 3600_000;

export const TOP_UP_MIN = 1000;
export const TOP_UP_MAX = 500_000;

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

/**
 * Card payments through Flutterwave (or the local test checkout), shared by checkout and wallet top-ups.
 * A payment only counts once Flutterwave's verify endpoint says it's successful for the right amount —
 * the shopper's redirect and the webhook only tell us when to check.
 */
@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly flutterwave?: FlutterwaveProvider;
  private readonly test?: TestPaymentProvider;
  private readonly paidHandlers = new Map<PaymentPurpose, PaidHandler>();
  private readonly afterPaid = new Map<PaymentPurpose, AfterPaidHandler>();
  private transferHandler?: (data: { id?: string; reference?: string }) => Promise<void>;
  private readonly allowedOrigins: Set<string>;
  private readonly webhookHash?: string;
  /** e.g. https://gbanjo-backend.onrender.com/api/v1 */
  readonly apiBase: string;
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly notifications: NotificationsService,
    @Inject(REDIS) redis: Redis,
    private readonly config: ConfigService<Env, true>,
    private readonly inbox: InboxService,
  ) {
    const publicUrl = (config.get("API_PUBLIC_URL", { infer: true }) ?? config.get("RENDER_EXTERNAL_URL", { infer: true }) ?? `http://localhost:${config.get("PORT", { infer: true })}`).replace(/\/$/, "");
    this.apiBase = `${publicUrl}/${config.get("API_PREFIX", { infer: true })}/v1`;

    const key = config.get("FLW_SECRET_KEY", { infer: true });
    if (key) this.flutterwave = new FlutterwaveProvider(key, config.get("FLW_BASE_URL", { infer: true }));
    if (config.get("NODE_ENV", { infer: true }) !== "production") this.test = new TestPaymentProvider(redis, this.apiBase);
    this.webhookHash = config.get("FLW_SECRET_HASH", { infer: true });

    this.allowedOrigins = new Set(
      [config.get("CORS_ORIGINS", { infer: true }), config.get("PAYMENT_RETURN_ORIGINS", { infer: true })]
        .join(",")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => {
          try {
            return new URL(o).origin;
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    );

    // Wallet top-ups: the money goes into the wallet in the same transaction that marks the payment paid.
    this.onPaid(
      "TOP_UP",
      async (tx, p) => {
        await this.wallets.credit(tx, {
          userId: p.userId,
          amount: Number(p.amount),
          type: "TOP_UP",
          reference: `topup:${p.reference}`,
          description: "Wallet top-up",
          paymentId: p.id,
        });
      },
      async (p) => {
        await this.inbox.notify(p.userId, { type: "payment", title: `${naira(Number(p.amount))} added to your wallet`, body: `Top-up ${p.reference} went through.`, href: "/profile/wallet/history" });
        const user = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { email: true, firstName: true } });
        if (!user) return;
        await this.notifications.message({
          email: user.email,
          subject: `Receipt: ${naira(Number(p.amount))} added to your Gbanjo wallet`,
          text: `Hi ${user.firstName},\n\n${naira(Number(p.amount))} has been added to your Gbanjo wallet.\n\nTransaction ID: ${p.reference}\nDate: ${(p.paidAt ?? new Date()).toUTCString()}\n\n— The Gbanjo team`,
        });
      },
    );
  }

  onModuleInit() {
    // Catch payments whose redirect and webhook never reached us.
    if (this.config.get("NODE_ENV", { infer: true }) === "test") return;
    this.sweeper = setInterval(() => void this.sweep().catch((e) => this.logger.warn(`sweep: ${(e as Error).message}`)), 10 * 60_000);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /** Withdrawals: called for Flutterwave "transfer.completed" webhooks. */
  onTransferEvent(fn: (data: { id?: string; reference?: string }) => Promise<void>) {
    this.transferHandler = fn;
  }

  /** The gateway bank transfers use (Flutterwave, or the test stand-in outside production). */
  transferProvider(): PaymentProvider {
    const p = this.flutterwave ?? this.test;
    if (!p) throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENTS_NOT_CONFIGURED", "Withdrawals aren't available right now. Please try again later.");
    return p;
  }

  /** The gateway a withdrawal was sent with. */
  providerNamed(name: string): PaymentProvider | undefined {
    return name === "flutterwave" ? this.flutterwave : name === "test" ? this.test : undefined;
  }

  /** Lets another module give value when a payment for `purpose` succeeds. */
  onPaid(purpose: PaymentPurpose, inTx: PaidHandler, after?: AfterPaidHandler) {
    this.paidHandlers.set(purpose, inTx);
    if (after) this.afterPaid.set(purpose, after);
  }

  /** Unique payment reference, e.g. GBJ-MGQ3K2X1-8F2A9C. */
  newReference() {
    return `GBJ-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  }

  /** The gateway new card payments use; throws when card payments aren't set up. */
  cardProvider(): PaymentProvider {
    const p = this.flutterwave ?? this.test;
    if (!p) throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, "PAYMENTS_NOT_CONFIGURED", "Card payments aren't available right now. Please pay from your wallet or try again later.");
    return p;
  }

  private providerFor(payment: Pick<Payment, "provider">): PaymentProvider | undefined {
    return payment.provider === "flutterwave" ? this.flutterwave : payment.provider === "test" ? this.test : undefined;
  }

  /** Accepts the website (any CORS origin) or the app (gbanjo://, exp://) as the page to return to after paying. */
  checkReturnUrl(url?: string): string | undefined {
    if (!url) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_RETURN_URL", "That return link isn't valid.");
    }
    const ok = APP_SCHEMES.has(parsed.protocol) || ((parsed.protocol === "https:" || parsed.protocol === "http:") && this.allowedOrigins.has(parsed.origin));
    if (!ok) throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_RETURN_URL", "That return link isn't allowed.");
    return url;
  }

  /** Creates the hosted payment page for a PENDING payment. On failure the payment is marked failed and the error re-thrown. */
  async startCheckout(payment: Payment, description: string): Promise<string> {
    const provider = this.providerFor(payment) ?? this.cardProvider();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payment.userId }, select: { email: true, firstName: true, lastName: true, phone: true } });
    try {
      const { checkoutUrl } = await provider.initialize({
        reference: payment.reference,
        amount: Number(payment.amount),
        currency: payment.currency,
        redirectUrl: `${this.apiBase}/payments/flutterwave/return`,
        customer: { email: user.email, name: `${user.firstName} ${user.lastName}`.trim(), phone: user.phone },
        title: "Gbanjo",
        description,
        method: payment.method,
        meta: { purpose: payment.purpose, userId: payment.userId },
      });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { checkoutUrl } });
      return checkoutUrl;
    } catch (e) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: "Couldn't start the payment" } });
      throw e;
    }
  }

  async topUp(userId: string, dto: TopUpDto): Promise<PaymentDto> {
    const returnUrl = this.checkReturnUrl(dto.returnUrl);
    const provider = this.cardProvider();
    const payment = await this.prisma.payment.create({
      data: { reference: this.newReference(), userId, purpose: "TOP_UP", method: dto.method ?? "card", amount: dto.amount, provider: provider.name, returnUrl },
    });
    await this.startCheckout(payment, `Add ${naira(dto.amount)} to your Gbanjo wallet`);
    return this.get(userId, payment.reference);
  }

  async get(userId: string, reference: string): Promise<PaymentDto> {
    const p = await this.prisma.payment.findUnique({ where: { reference }, include: { orders: { select: { id: true }, orderBy: { id: "asc" } } } });
    if (!p || p.userId !== userId) throw new AppException(HttpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND", "We couldn't find that payment.");
    return toDto(p, p.orders.map((o) => o.id));
  }

  /** Checks with the gateway and settles the payment. `hint` is the status from the shopper's redirect. */
  async verify(reference: string, transactionId?: string, hint?: string): Promise<Payment | null> {
    const payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) return null;
    if (payment.status === "SUCCESSFUL") return payment;
    const provider = this.providerFor(payment);
    if (!provider) return payment;

    const v = await provider.verify(reference, transactionId).catch((e) => {
      this.logger.warn(`verify ${reference}: ${(e as Error).message}`);
      return null;
    });
    if (v && v.reference !== reference) {
      this.logger.warn(`verify ${reference}: gateway returned ${v.reference}; ignoring`);
      return payment;
    }
    if (v?.status === "successful") {
      if (v.currency !== payment.currency || v.amount < Number(payment.amount)) {
        this.logger.error(`verify ${reference}: paid ${v.currency} ${v.amount}, expected ${payment.currency} ${payment.amount}`);
        return this.markUnpaid(payment, "FAILED", "The amount paid didn't match");
      }
      return this.markPaid(payment, v.transactionId);
    }
    if (v?.status === "failed") return this.markUnpaid(payment, "FAILED", "The payment was declined");
    if (v?.status === "cancelled" || (!v && hint === "cancelled")) return this.markUnpaid(payment, "CANCELED", "The payment was canceled");
    return payment;
  }

  /** The shopper's own "check again" button (and the apps after the payment page closes). */
  async verifyForUser(userId: string, reference: string, hint?: string): Promise<PaymentDto> {
    await this.get(userId, reference); // ownership check
    await this.verify(reference, undefined, hint);
    return this.get(userId, reference);
  }

  /** Marks the payment paid and runs the purpose's handler — exactly once, however many times it's called. */
  async markPaid(payment: Payment, providerTxId?: string): Promise<Payment> {
    const handler = this.paidHandlers.get(payment.purpose);
    const paidNow = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: "SUCCESSFUL" } },
        data: { status: "SUCCESSFUL", paidAt: new Date(), failureReason: null, ...(providerTxId ? { providerTxId } : {}) },
      });
      if (!count) return null;
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      await handler?.(tx, fresh);
      return fresh;
    });
    if (paidNow) {
      this.logger.log(`Payment ${payment.reference} (${payment.purpose}) paid`);
      await this.afterPaid.get(payment.purpose)?.(paidNow).catch((e) => this.logger.warn(`after-paid ${payment.reference}: ${(e as Error).message}`));
      return paidNow;
    }
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private async markUnpaid(payment: Payment, status: "FAILED" | "CANCELED", reason: string) {
    await this.prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status, failureReason: reason } });
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  /** Where Flutterwave sends the shopper: settle, then forward to the website/app page they came from. */
  async handleReturn(q: { tx_ref?: string; transaction_id?: string; status?: string }): Promise<string | null> {
    if (!q.tx_ref) return null;
    const payment = await this.verify(q.tx_ref, q.transaction_id, q.status?.toLowerCase());
    if (!payment?.returnUrl) return null;
    const url = new URL(payment.returnUrl);
    url.searchParams.set("reference", payment.reference);
    url.searchParams.set("status", payment.status.toLowerCase());
    return url.toString();
  }

  /** Flutterwave webhook: check the secret hash, then verify the transaction it mentions. */
  async handleWebhook(signature: string | undefined, body: { event?: string; type?: string; data?: { id?: number | string; tx_ref?: string; txRef?: string } }) {
    if (!this.webhookHash || !signature || !safeEqual(signature, this.webhookHash)) {
      throw new AppException(HttpStatus.UNAUTHORIZED, "INVALID_SIGNATURE", "Webhook signature didn't match.");
    }
    const kind = `${body?.event ?? ""} ${body?.type ?? ""} ${(body as Record<string, unknown>)?.["event.type"] ?? ""}`.toLowerCase();
    if (kind.includes("transfer")) {
      await this.transferHandler?.({ id: body.data?.id ? String(body.data.id) : undefined, reference: (body.data as { reference?: string } | undefined)?.reference });
      return { received: true };
    }
    const ref = body?.data?.tx_ref ?? body?.data?.txRef;
    if (!ref) return { received: true };
    await this.verify(ref, body.data?.id ? String(body.data.id) : undefined);
    return { received: true };
  }

  /** Test checkout (no Flutterwave keys, never in production). */
  testCheckout() {
    if (!this.test) throw new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found.");
    return this.test;
  }

  /** Sends money back to the card a payment came from. Returns false if the gateway refused (caller refunds to the wallet instead). */
  /**
   * Sends money back to the card. "refunded" = Flutterwave accepted it; "rejected" = Flutterwave said no
   * (safe to refund to the wallet instead); "unknown" = no clear answer (network/timeout) — it may still go
   * through, so we must NOT also refund to the wallet (that could pay the buyer twice).
   */
  async refundToCard(payment: Payment, amount: number): Promise<"refunded" | "rejected" | "unknown"> {
    const provider = this.providerFor(payment);
    if (!provider || !payment.providerTxId) return "rejected";
    try {
      await provider.refund(payment.providerTxId, amount);
      return "refunded";
    } catch (e) {
      const unknown = e instanceof AppException; // network / bad reply from the provider
      this.logger.error(`refund ${payment.reference} (${amount}) ${unknown ? "OUTCOME UNKNOWN — check on the Flutterwave dashboard" : "refused"}: ${(e as Error).message}`);
      return unknown ? "unknown" : "rejected";
    }
  }

  /** Re-checks recent unpaid card payments and expires old ones. */
  async sweep() {
    const now = Date.now();
    const pending = await this.prisma.payment.findMany({
      where: { status: "PENDING", provider: { in: ["flutterwave", "test"] }, createdAt: { lte: new Date(now - 5 * 60_000) } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    for (const p of pending) {
      const after = await this.verify(p.reference);
      if (after?.status === "PENDING" && now - p.createdAt.getTime() > EXPIRE_AFTER_MS) await this.markUnpaid(p, "CANCELED", "The payment wasn't completed in time");
    }
    await this.wallets.settle();
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function toDto(p: Payment, orderIds: string[] = []): PaymentDto {
  return {
    reference: p.reference,
    purpose: p.purpose === "TOP_UP" ? "top-up" : "order",
    status: p.status.toLowerCase() as PaymentDto["status"],
    method: p.method,
    amount: Number(p.amount),
    currency: p.currency,
    checkoutUrl: p.status === "PENDING" ? p.checkoutUrl : null,
    failureReason: p.failureReason,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    orderIds,
  };
}
