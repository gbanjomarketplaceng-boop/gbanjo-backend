import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomInt } from "node:crypto";
import type { Order, OrderItem, OrderStatus, Payment, Prisma } from "../../generated/prisma/client";
import { AppException } from "../../common/exceptions/app.exception";
import { normalizeNigerianPhone } from "../../common/utils/phone";
import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import { NotificationsService } from "../notifications/notifications.service";
import { PaymentsService, toDto as paymentDto } from "../payments/payments.service";
import { WalletService } from "../wallet/wallet.service";
import { type CheckoutDto, type CheckoutResultDto, type OrderDto, STAGES, type VoucherDto } from "./dto/orders.dto";

type Tx = Prisma.TransactionClient;

const ORDER_INCLUDE = {
  items: { orderBy: { id: "asc" } },
  payment: { select: { reference: true, method: true } },
  buyer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  seller: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
} as const satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const STATUS_OUT: Record<OrderStatus, OrderDto["status"]> = { AWAITING_PAYMENT: "ongoing", ONGOING: "ongoing", COMPLETED: "completed", CANCELED: "canceled" };
const STATUS_IN = { ongoing: "ONGOING", completed: "COMPLETED", canceled: "CANCELED" } as const;
/** Buyers and sellers can cancel until the parcel ships. */
const CANCELLABLE_BEFORE_STAGE = 2;
const ETA_DAYS = { standard: [5, 7], express: [1, 2] } as const;

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

interface Line {
  productId: string;
  slug: string;
  name: string;
  option: string;
  imageUrl: string;
  price: number;
  qty: number;
  sellerId: string | null;
}

/**
 * Checkout and the life of an order. A checkout makes one order per seller, all paid by one payment
 * (wallet: at once; card: on Flutterwave). Sellers move their orders through the shipment stages; when
 * one is delivered the seller's earnings are held for ORDER_PAYOUT_HOLD_DAYS, then reach their wallet.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly wallets: WalletService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {
    payments.onPaid(
      "ORDER",
      (tx, p) => this.markPaid(tx, p),
      (p) => this.notifyPaid(p.id),
    );
  }

  // ---------- Checkout ----------

  async checkout(userId: string, dto: CheckoutDto): Promise<CheckoutResultDto> {
    const byWallet = dto.paymentMethod === "wallet";
    const returnUrl = byWallet ? undefined : this.payments.checkReturnUrl(dto.returnUrl);
    const provider = byWallet ? null : this.payments.cardProvider();

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, firstName: true, lastName: true, phone: true } });
    const delivery = await this.delivery(userId, dto, user);
    const lines = await this.lines(userId, dto);
    const percentOff = dto.voucher ? (await this.voucher(dto.voucher)).percentOff : 0;

    // One order per seller; the delivery fee is charged once (on the first order).
    const groups = new Map<string | null, Line[]>();
    for (const l of lines) groups.set(l.sellerId, [...(groups.get(l.sellerId) ?? []), l]);
    const shippingFee = dto.shipping === "express" ? this.config.get("SHIPPING_EXPRESS_FEE", { infer: true }) : 0;
    const now = new Date();
    const [fromDays, toDays] = ETA_DAYS[dto.shipping];
    const ids = await this.newOrderIds(groups.size);
    const drafts = [...groups.entries()].map(([sellerId, items], i) => {
      const subtotal = items.reduce((s, l) => s + l.price * l.qty, 0);
      const discount = Math.round((subtotal * percentOff) / 100);
      const fee = i === 0 ? shippingFee : 0;
      return { id: ids[i], sellerId, items, subtotal, discount, shippingFee: fee, total: subtotal - discount + fee };
    });
    const amount = drafts.reduce((s, d) => s + d.total, 0);
    const reference = this.payments.newReference();

    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          reference,
          userId,
          purpose: "ORDER",
          method: dto.paymentMethod,
          amount,
          provider: provider?.name ?? "wallet",
          returnUrl,
          ...(byWallet ? { status: "SUCCESSFUL", paidAt: now } : {}),
        },
      });
      for (const d of drafts) {
        await tx.order.create({
          data: {
            id: d.id,
            buyerId: userId,
            sellerId: d.sellerId,
            paymentId: p.id,
            status: byWallet ? "ONGOING" : "AWAITING_PAYMENT",
            stageTimes: byWallet ? [now] : [],
            paidAt: byWallet ? now : null,
            ...delivery,
            shippingMethod: dto.shipping,
            shippingFee: d.shippingFee,
            subtotal: d.subtotal,
            discount: d.discount,
            total: d.total,
            voucherCode: percentOff ? dto.voucher!.trim().toUpperCase() : null,
            etaFrom: addDays(now, fromDays),
            etaTo: addDays(now, toDays),
            items: {
              create: d.items.map((l) => ({ productId: l.productId, productSlug: l.slug, name: l.name, option: l.option, imageUrl: l.imageUrl, price: l.price, qty: l.qty })),
            },
          },
        });
      }
      if (byWallet) {
        await this.wallets.debit(tx, {
          userId,
          amount,
          type: "ORDER_PAYMENT",
          reference: `order:${reference}`,
          description: `Payment for order ${drafts.map((d) => `#${d.id}`).join(", ")}`,
          paymentId: p.id,
        });
        await this.clearBought(tx, userId, p.id);
      }
      return p;
    });

    if (byWallet) {
      await this.notifyPaid(payment.id);
    } else {
      try {
        await this.payments.startCheckout(payment, `Order ${drafts.map((d) => `#${d.id}`).join(", ")}`);
      } catch (e) {
        await this.prisma.order.deleteMany({ where: { paymentId: payment.id } });
        throw e;
      }
    }

    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const orders = await this.prisma.order.findMany({ where: { paymentId: payment.id }, include: ORDER_INCLUDE, orderBy: { id: "asc" } });
    return { payment: paymentDto(fresh, orders.map((o) => o.id)), orders: orders.map((o) => this.toDto(o, { id: userId, role: "USER" })) };
  }

  /** Where to deliver: typed details, a chosen saved address, or the default address. */
  private async delivery(userId: string, dto: CheckoutDto, user: { email: string; firstName: string; lastName: string; phone: string | null }) {
    let recipient: string;
    let phone: string | null | undefined;
    let address: string;
    if (dto.address) {
      recipient = dto.recipient?.trim() || fullName(user);
      phone = dto.phone ?? user.phone;
      address = dto.address.trim();
    } else {
      const saved = dto.addressId
        ? await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } })
        : ((await this.prisma.address.findFirst({ where: { userId, isDefault: true } })) ?? (await this.prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } })));
      if (!saved)
        throw new AppException(HttpStatus.BAD_REQUEST, "ADDRESS_REQUIRED", "Add a delivery address first.", { fields: { address: "Add a delivery address first." } });
      recipient = saved.name;
      phone = dto.phone ?? saved.phone;
      address = saved.address;
    }
    const normalized = phone ? normalizeNigerianPhone(phone) : null;
    if (!normalized)
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_PHONE", "Enter a valid Nigerian phone number for the delivery.", { fields: { phone: "Enter a valid Nigerian phone number" } });
    return { recipient, phone: normalized, address, email: dto.email?.toLowerCase() ?? user.email };
  }

  /** What's being bought, priced from the database (never from the request). */
  private async lines(userId: string, dto: CheckoutDto): Promise<Line[]> {
    const wanted =
      dto.items ??
      (await this.prisma.cartItem.findMany({ where: { userId }, include: { product: { select: { slug: true } } }, orderBy: { createdAt: "asc" } })).map((c) => ({
        productId: c.product.slug,
        qty: c.quantity,
        option: c.option,
      }));
    if (!wanted.length) throw new AppException(HttpStatus.BAD_REQUEST, "CART_EMPTY", "Your cart is empty.");

    const bySlug = new Map<string, { qty: number; option?: string }>();
    for (const w of wanted) bySlug.set(w.productId, { qty: Math.min(99, (bySlug.get(w.productId)?.qty ?? 0) + w.qty), option: w.option ?? bySlug.get(w.productId)?.option });
    const products = await this.prisma.product.findMany({
      where: { slug: { in: [...bySlug.keys()] }, status: "ACTIVE" },
      select: { id: true, slug: true, name: true, price: true, imageUrl: true, sellerId: true },
    });
    const found = new Set(products.map((p) => p.slug));
    const missing = [...bySlug.keys()].filter((s) => !found.has(s));
    if (missing.length)
      throw new AppException(HttpStatus.CONFLICT, "ITEMS_UNAVAILABLE", missing.length === 1 ? "An item in your cart isn't available any more. Remove it and try again." : "Some items in your cart aren't available any more. Remove them and try again.", { items: missing });
    if (products.some((p) => p.sellerId === userId)) throw new AppException(HttpStatus.BAD_REQUEST, "OWN_LISTING", "You can't buy your own listing.");

    return products.map((p) => {
      const w = bySlug.get(p.slug)!;
      return { productId: p.id, slug: p.slug, name: p.name, option: w.option ?? "", imageUrl: p.imageUrl, price: Number(p.price), qty: w.qty, sellerId: p.sellerId };
    });
  }

  private async newOrderIds(n: number): Promise<string[]> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const ids = [...new Set(Array.from({ length: n }, () => String(randomInt(10_000_000, 100_000_000))))];
      if (ids.length < n) continue;
      if (!(await this.prisma.order.count({ where: { id: { in: ids } } }))) return ids;
    }
    throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, "TRY_AGAIN", "Please try again.");
  }

  /** Removes what was just bought from the buyer's cart. */
  private async clearBought(tx: Tx, userId: string, paymentId: string) {
    const items = await tx.orderItem.findMany({ where: { order: { paymentId } }, select: { productId: true } });
    const ids = items.map((i) => i.productId).filter((x): x is string => !!x);
    if (ids.length) await tx.cartItem.deleteMany({ where: { userId, productId: { in: ids } } });
  }

  /** Card payment went through: the orders become live (runs inside the payment's transaction). */
  private async markPaid(tx: Tx, p: Payment) {
    const paidAt = p.paidAt ?? new Date();
    await tx.order.updateMany({ where: { paymentId: p.id, status: "AWAITING_PAYMENT" }, data: { status: "ONGOING", stage: 0, stageTimes: [paidAt], paidAt } });
    await this.clearBought(tx, p.userId, p.id);
  }

  // ---------- Vouchers ----------

  async voucher(code: string): Promise<VoucherDto> {
    const v = await this.prisma.voucher.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!v || !v.active || (v.expiresAt && v.expiresAt < new Date()))
      throw new AppException(HttpStatus.NOT_FOUND, "INVALID_VOUCHER", "That voucher code isn't valid.", { fields: { voucher: "That voucher code isn't valid." } });
    return { code: v.code, percentOff: v.percentOff };
  }

  // ---------- Reading ----------

  async list(user: AuthUser, side: "buy" | "sell" = "buy", status?: "ongoing" | "completed" | "canceled"): Promise<OrderDto[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        ...(side === "sell" ? { sellerId: user.id } : { buyerId: user.id }),
        status: status ? STATUS_IN[status] : { not: "AWAITING_PAYMENT" },
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((o) => this.toDto(o, user));
  }

  async adminList(status?: "ongoing" | "completed" | "canceled"): Promise<OrderDto[]> {
    const rows = await this.prisma.order.findMany({
      where: { status: status ? STATUS_IN[status] : { not: "AWAITING_PAYMENT" } },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((o) => this.toDto(o, { id: "", role: "ADMIN" }));
  }

  async get(user: Pick<AuthUser, "id" | "role">, id: string): Promise<OrderDto> {
    return this.toDto(await this.find(user, id), user);
  }

  private async find(user: Pick<AuthUser, "id" | "role">, id: string): Promise<OrderRow> {
    const o = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    const mine = o && (o.buyerId === user.id || o.sellerId === user.id || user.role === "ADMIN");
    if (!o || !mine || o.status === "AWAITING_PAYMENT") throw new AppException(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND", "We couldn't find that order.");
    return o;
  }

  // ---------- Changes ----------

  /** Seller (or an admin): move the order to the next shipment stage. Delivered completes it and starts the seller's payout hold. */
  async advance(user: Pick<AuthUser, "id" | "role">, id: string): Promise<OrderDto> {
    const o = await this.find(user, id);
    if (!this.canAdvance(o, user))
      throw new AppException(HttpStatus.FORBIDDEN, "CANT_UPDATE_ORDER", o.status === "ONGOING" ? "Only the seller can update this order." : "This order can't be updated any more.");
    const stage = o.stage + 1;
    const now = new Date();
    const delivered = stage === STAGES.length - 1;
    const moved = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, status: "ONGOING", stage: o.stage },
        data: { stage, stageTimes: { push: now }, ...(delivered ? { status: "COMPLETED", deliveredAt: now } : {}) },
      });
      if (!count) return false;
      if (delivered && o.sellerId) {
        const feePct = this.config.get("PLATFORM_FEE_PERCENT", { infer: true });
        const earnings = Math.round(Number(o.subtotal) * (100 - feePct)) / 100;
        await this.wallets.credit(tx, {
          userId: o.sellerId,
          amount: earnings,
          type: "SALE",
          reference: `sale:${o.id}`,
          description: `Sale · order #${o.id}`,
          orderId: o.id,
          availableAt: addDays(now, this.config.get("ORDER_PAYOUT_HOLD_DAYS", { infer: true })),
        });
      }
      return true;
    });
    if (!moved) throw new AppException(HttpStatus.CONFLICT, "ORDER_CHANGED", "This order was just updated. Refresh and try again.");
    const fresh = await this.find(user, id);
    void this.notifyStage(fresh);
    return this.toDto(fresh, user);
  }

  /** Buyer or seller before it ships (an admin any time before delivery). The payment goes back where it came from. */
  async cancel(user: Pick<AuthUser, "id" | "role">, id: string): Promise<OrderDto> {
    const o = await this.find(user, id);
    if (!this.canCancel(o, user))
      throw new AppException(HttpStatus.CONFLICT, "CANT_CANCEL", o.status === "ONGOING" ? "This order has already shipped, so it can't be canceled." : "This order can't be canceled.");
    const by = o.buyerId === user.id ? "buyer" : o.sellerId === user.id ? "seller" : "admin";
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: o.paymentId } });
    const total = Number(o.total);
    const byWallet = payment.method === "wallet";

    const canceled = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, status: "ONGOING", ...(by === "admin" ? {} : { stage: { lt: CANCELLABLE_BEFORE_STAGE } }) },
        data: { status: "CANCELED", canceledAt: new Date(), canceledBy: by, ...(byWallet ? { refundTo: "wallet" } : {}) },
      });
      if (!count) return false;
      if (byWallet) await this.refundToWallet(tx, o, total);
      return true;
    });
    if (!canceled) throw new AppException(HttpStatus.CONFLICT, "ORDER_CHANGED", "This order was just updated. Refresh and try again.");

    if (!byWallet) {
      const toCard = await this.payments.refundToCard(payment, total);
      if (!toCard) await this.prisma.$transaction((tx) => this.refundToWallet(tx, o, total));
      await this.prisma.order.update({ where: { id }, data: { refundTo: toCard ? "card" : "wallet" } });
    }
    const fresh = await this.find(user, id);
    void this.notifyCanceled(fresh);
    return this.toDto(fresh, user);
  }

  private refundToWallet(tx: Tx, o: Pick<Order, "id" | "buyerId">, amount: number) {
    return this.wallets.credit(tx, { userId: o.buyerId, amount, type: "REFUND", reference: `refund:${o.id}`, description: `Refund · order #${o.id}`, orderId: o.id });
  }

  private canCancel(o: Order, user: Pick<AuthUser, "id" | "role">) {
    if (o.status !== "ONGOING") return false;
    if (user.role === "ADMIN") return true;
    return (o.buyerId === user.id || o.sellerId === user.id) && o.stage < CANCELLABLE_BEFORE_STAGE;
  }

  private canAdvance(o: Order, user: Pick<AuthUser, "id" | "role">) {
    return o.status === "ONGOING" && o.stage < STAGES.length - 1 && (user.role === "ADMIN" || (!!o.sellerId && o.sellerId === user.id));
  }

  toDto(o: OrderRow, viewer: Pick<AuthUser, "id" | "role">): OrderDto {
    const nextOk = this.canAdvance(o, viewer);
    return {
      id: o.id,
      side: o.buyerId === viewer.id ? "buy" : "sell",
      status: STATUS_OUT[o.status],
      stage: o.stage,
      stageLabel: o.status === "CANCELED" ? "Canceled" : STAGES[o.stage],
      stageTimes: STAGES.map((_, i) => o.stageTimes[i]?.toISOString() ?? null),
      items: o.items.map((i: OrderItem) => ({ productId: i.productSlug, name: i.name, option: i.option, price: Number(i.price), image: i.imageUrl, qty: i.qty })),
      recipient: o.recipient,
      phone: o.phone,
      address: o.address,
      email: o.email,
      placedAt: o.paidAt ?? o.createdAt,
      eta: { from: o.etaFrom, to: o.etaTo },
      shipping: { method: o.shippingMethod, fee: Number(o.shippingFee) },
      subtotal: Number(o.subtotal),
      discount: Number(o.discount),
      total: Number(o.total),
      voucher: o.voucherCode,
      paidWith: o.payment.method,
      paymentReference: o.payment.reference,
      buyer: { id: o.buyer.id, name: fullName(o.buyer) },
      seller: o.seller ? { id: o.seller.id, name: fullName(o.seller) } : null,
      canCancel: this.canCancel(o, viewer),
      canAdvance: nextOk,
      nextStage: nextOk ? STAGES[o.stage + 1] : null,
      deliveredAt: o.deliveredAt,
      canceledAt: o.canceledAt,
      canceledBy: o.canceledBy,
      refundTo: o.refundTo,
    };
  }

  // ---------- Notifications (never fail the request) ----------

  private async notifyPaid(paymentId: string) {
    try {
      const orders = await this.prisma.order.findMany({ where: { paymentId, status: "ONGOING" }, include: ORDER_INCLUDE, orderBy: { id: "asc" } });
      if (!orders.length) return;
      const buyer = orders[0].buyer;
      const lines = orders.flatMap((o) => o.items.map((i) => `• ${i.name}${i.option ? ` (${i.option})` : ""} × ${i.qty} — ${naira(Number(i.price) * i.qty)}`));
      const total = orders.reduce((s, o) => s + Number(o.total), 0);
      await this.notifications.message({
        email: orders[0].email ?? buyer.email,
        subject: `Order confirmed: ${orders.map((o) => `#${o.id}`).join(", ")}`,
        text: `Hi ${buyer.firstName},\n\nThanks for shopping on Gbanjo! We've received your payment of ${naira(total)}.\n\n${lines.join("\n")}\n\nDelivering to: ${orders[0].recipient}, ${orders[0].address}\n\nYou can track your order in the Gbanjo app or on gbanjomarket.com under Orders.\n\n— The Gbanjo team`,
      });
      for (const o of orders) {
        if (!o.seller) continue;
        const count = o.items.reduce((n, i) => n + i.qty, 0);
        await this.notifications.message({
          email: o.seller.email,
          phone: o.seller.phone,
          subject: `New order #${o.id} on Gbanjo`,
          text: `Hi ${o.seller.firstName},\n\nYou have a new order (#${o.id}):\n\n${o.items.map((i) => `• ${i.name}${i.option ? ` (${i.option})` : ""} × ${i.qty}`).join("\n")}\n\nDeliver to: ${o.recipient} · ${o.phone}\n${o.address}\n\nOpen Orders → Sell to pack it and update the buyer as it moves.\n\n— The Gbanjo team`,
          sms: `Gbanjo: new order #${o.id} (${count} item${count === 1 ? "" : "s"}, ${naira(Number(o.subtotal))}). Open Orders > Sell to pack it.`,
        });
      }
    } catch (e) {
      this.logger.warn(`notifyPaid ${paymentId}: ${(e as Error).message}`);
    }
  }

  private async notifyStage(o: OrderRow) {
    if (o.stage < 2) return;
    const label = STAGES[o.stage];
    await this.notifications.message({
      email: o.email ?? o.buyer.email,
      phone: o.phone,
      subject: `Order #${o.id}: ${label}`,
      text: `Hi ${o.buyer.firstName},\n\nYour order #${o.id} is now: ${label}.${o.stage === 4 ? "\n\nEnjoy your purchase! You can leave a review on the product page." : ""}\n\n— The Gbanjo team`,
      ...(o.stage === 3 ? { sms: `Gbanjo: your order #${o.id} is out for delivery. Please keep your phone close.` } : {}),
    });
  }

  private async notifyCanceled(o: OrderRow) {
    const refund = o.refundTo === "card" ? "Your payment is being refunded to your card (this can take a few days)." : "Your payment has been refunded to your Gbanjo wallet.";
    await this.notifications.message({
      email: o.email ?? o.buyer.email,
      subject: `Order #${o.id} canceled`,
      text: `Hi ${o.buyer.firstName},\n\nOrder #${o.id} was canceled${o.canceledBy === "seller" ? " by the seller" : ""}. ${refund}\n\n— The Gbanjo team`,
    });
    if (o.seller && o.canceledBy !== "seller")
      await this.notifications.message({
        email: o.seller.email,
        subject: `Order #${o.id} canceled`,
        text: `Hi ${o.seller.firstName},\n\nOrder #${o.id} was canceled${o.canceledBy === "buyer" ? " by the buyer" : ""}. You don't need to send it.\n\n— The Gbanjo team`,
      });
  }
}
