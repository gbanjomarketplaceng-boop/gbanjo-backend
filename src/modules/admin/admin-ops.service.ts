import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { Prisma, type AdminRole } from "../../generated/prisma/client";
import { areasFor } from "../../common/admin/admin-areas";
import { SessionCacheService } from "../../common/cache/session-cache.service";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { InboxService } from "../inbox/inbox.service";
import { toWithdrawalDto } from "../payments/withdrawals.service";
import { listingSlug } from "../seller/seller.service";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";
import type {
  AdminLedgerQuery,
  AdminListingsQuery,
  AdminPaymentsQuery,
  BroadcastDto,
  CreateListingDto,
  CreateUserDto,
  SaveCategoryDto,
  SaveVoucherDto,
  UpdateListingDto,
  UpdateUserDto,
  UpdateVoucherDto,
} from "./dto/admin-ops.dto";

const PAGE = 50;
const DAY = 86_400_000;
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const lower = <T extends string>(s: T) => s.toLowerCase();
const num = (d: Prisma.Decimal | number | bigint | null | undefined) => (d === null || d === undefined ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);
const page = <T>(items: T[], total: number, p: number) => ({ items, total, page: p, pageSize: PAGE, pages: Math.max(1, Math.ceil(total / PAGE)) });
const PAID = ["ONGOING", "COMPLETED"] as const;
const invalidFields = (fields: Record<string, string>) => new AppException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", Object.values(fields)[0], { fields });

/** Start of the given day (Lagos time is UTC+1, close enough for day buckets → we use UTC days). */
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Spreadsheet-safe CSV: quotes every cell and defuses cells that start like a formula. */
export function toCsv(header: string[], rows: (string | number | null | undefined | Date)[][]): string {
  const cell = (v: string | number | null | undefined | Date) => {
    let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** The back office: money, catalog, customers, team, activity and announcements. */
@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly inbox: InboxService,
    private readonly sessionCache: SessionCacheService,
    private readonly users: UsersService,
  ) {}

  // ---------- Who am I ----------

  async me(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, firstName: true, lastName: true, email: true, adminRole: true } });
    const role = u.adminRole ?? "SUPER";
    return { id: u.id, name: fullName(u), email: u.email, adminRole: role, areas: areasFor(role) };
  }

  // ---------- Dashboard ----------

  async dashboard(days = 30) {
    const now = new Date();
    const from = new Date(dayStart(now).getTime() - (days - 1) * DAY);
    const prevFrom = new Date(from.getTime() - days * DAY);

    const paidIn = (a: Date, b: Date) => ({ status: { in: [...PAID] }, paidAt: { gte: a, lt: b } }) satisfies Prisma.OrderWhereInput;
    const [cur, prev, newUsers, prevUsers, activeListings, liability, held, awaiting, inFlight, revenue, prevRevenue, refunds, attention] = await Promise.all([
      this.prisma.order.aggregate({ where: paidIn(from, now), _sum: { total: true }, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: paidIn(prevFrom, from), _sum: { total: true }, _count: { _all: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: from } } }),
      this.prisma.user.count({ where: { createdAt: { gte: prevFrom, lt: from } } }),
      this.prisma.product.count({ where: { status: "ACTIVE" } }),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      this.prisma.walletTransaction.aggregate({ where: { status: "PENDING" }, _sum: { amount: true } }),
      this.prisma.withdrawal.aggregate({ where: { status: "AWAITING_APPROVAL" }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.withdrawal.aggregate({ where: { status: { in: ["PENDING", "PROCESSING"] } }, _sum: { amount: true }, _count: { _all: true } }),
      this.revenue(from, now),
      this.revenue(prevFrom, from),
      this.prisma.order.aggregate({ where: { status: "CANCELED", paidAt: { not: null }, canceledAt: { gte: from } }, _sum: { total: true }, _count: { _all: true } }),
      this.attention(),
    ]);

    const series = await this.prisma.$queryRaw<{ day: Date; orders: bigint; gmv: Prisma.Decimal | null }[]>`
      SELECT date_trunc('day', paid_at) AS day, count(*) AS orders, sum(total) AS gmv
      FROM orders WHERE status IN ('ONGOING','COMPLETED') AND paid_at >= ${from}
      GROUP BY 1 ORDER BY 1`;
    const signups = await this.prisma.$queryRaw<{ day: Date; n: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM users WHERE created_at >= ${from} GROUP BY 1`;
    const byDay = new Map(series.map((r) => [dayStart(r.day).toISOString().slice(0, 10), r]));
    const usersByDay = new Map(signups.map((r) => [dayStart(r.day).toISOString().slice(0, 10), Number(r.n)]));
    const daily = Array.from({ length: days }, (_, i) => {
      const d = new Date(from.getTime() + i * DAY).toISOString().slice(0, 10);
      const r = byDay.get(d);
      return { date: d, orders: r ? Number(r.orders) : 0, gmv: r ? num(r.gmv) : 0, signups: usersByDay.get(d) ?? 0 };
    });

    const topCategories = await this.prisma.$queryRaw<{ name: string; gmv: Prisma.Decimal; units: bigint }[]>`
      SELECT c.name, sum(oi.price * oi.qty) AS gmv, sum(oi.qty) AS units
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
      WHERE o.status IN ('ONGOING','COMPLETED') AND o.paid_at >= ${from}
      GROUP BY c.name ORDER BY gmv DESC LIMIT 5`;
    const topSellers = await this.prisma.$queryRaw<{ id: string; first_name: string; last_name: string; gmv: Prisma.Decimal; orders: bigint }[]>`
      SELECT u.id, u.first_name, u.last_name, sum(o.subtotal) AS gmv, count(*) AS orders
      FROM orders o JOIN users u ON u.id = o.seller_id
      WHERE o.status IN ('ONGOING','COMPLETED') AND o.paid_at >= ${from}
      GROUP BY u.id ORDER BY gmv DESC LIMIT 5`;

    const gmv = num(cur._sum.total);
    const orders = cur._count._all;
    return {
      days,
      from,
      kpis: {
        gmv,
        gmvChange: pct(gmv, num(prev._sum.total)),
        orders,
        ordersChange: pct(orders, prev._count._all),
        averageOrder: orders ? round2(gmv / orders) : 0,
        revenue: revenue.total,
        revenueChange: pct(revenue.total, prevRevenue.total),
        newUsers,
        newUsersChange: pct(newUsers, prevUsers),
        activeListings,
        refunds: num(refunds._sum.total),
        refundCount: refunds._count._all,
        walletBalances: num(liability._sum.balance),
        heldEarnings: num(held._sum.amount),
        withdrawalsAwaitingApproval: { count: awaiting._count._all, amount: num(awaiting._sum.amount) },
        withdrawalsInFlight: { count: inFlight._count._all, amount: num(inFlight._sum.amount) },
      },
      daily,
      topCategories: topCategories.map((c) => ({ name: c.name, gmv: num(c.gmv), units: Number(c.units) })),
      topSellers: topSellers.map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name}`.trim(), gmv: num(s.gmv), orders: Number(s.orders) })),
      attention,
    };
  }

  /** What needs someone today. */
  private async attention() {
    const [sellerIds, reports, messages, withdrawals, stuckOrders, failedRefunds] = await Promise.all([
      this.prisma.sellerVerification.count({ where: { status: "PENDING" } }),
      this.prisma.report.count({ where: { status: "OPEN" } }),
      this.prisma.contactMessage.count({ where: { status: "NEW" } }),
      this.prisma.withdrawal.count({ where: { status: "AWAITING_APPROVAL" } }),
      // Paid more than 3 days ago and still not shipped.
      this.prisma.order.count({ where: { status: "ONGOING", stage: { lt: 2 }, paidAt: { lt: new Date(Date.now() - 3 * DAY) } } }),
      this.prisma.withdrawal.count({ where: { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - DAY) } } }),
    ]);
    return { sellerIds, reports, messages, withdrawals, stuckOrders, slowTransfers: failedRefunds };
  }

  /** Gbanjo's own money: commission on delivered sales + items Gbanjo sold itself (no seller). */
  private async revenue(from: Date, to: Date) {
    const [commission, own] = await Promise.all([
      this.prisma.order.aggregate({ where: { status: "COMPLETED", sellerId: { not: null }, deliveredAt: { gte: from, lt: to } }, _sum: { platformFee: true } }),
      this.prisma.order.aggregate({ where: { status: "COMPLETED", sellerId: null, deliveredAt: { gte: from, lt: to } }, _sum: { subtotal: true, discount: true } }),
    ]);
    const c = num(commission._sum.platformFee);
    const o = num(own._sum.subtotal) - num(own._sum.discount);
    return { commission: c, ownSales: o, total: round2(c + o) };
  }

  // ---------- Finance ----------

  private range(fromIso?: string, toIso?: string) {
    const to = toIso ? new Date(dayStart(new Date(toIso)).getTime() + DAY) : new Date();
    const from = fromIso ? dayStart(new Date(fromIso)) : new Date(dayStart(new Date()).getTime() - 29 * DAY);
    if (from >= to) throw new AppException(HttpStatus.BAD_REQUEST, "BAD_RANGE", "The start date must be before the end date.");
    if (to.getTime() - from.getTime() > 400 * DAY) throw new AppException(HttpStatus.BAD_REQUEST, "RANGE_TOO_LONG", "Pick a range of up to a year.");
    return { from, to };
  }

  async financeSummary(fromIso?: string, toIso?: string) {
    const { from, to } = this.range(fromIso, toIso);
    const paid = { status: { in: [...PAID] }, paidAt: { gte: from, lt: to } } satisfies Prisma.OrderWhereInput;
    const ledgerSum = (type: Prisma.WalletTransactionWhereInput["type"], sign?: "in" | "out") =>
      this.prisma.walletTransaction.aggregate({
        where: { type, createdAt: { gte: from, lt: to }, ...(sign === "in" ? { amount: { gt: 0 } } : sign === "out" ? { amount: { lt: 0 } } : {}) },
        _sum: { amount: true },
        _count: { _all: true },
      });
    const [orders, rev, canceled, topUps, withdrawn, withdrawReturned, adjustIn, adjustOut, payouts, byMethod, balances, held] = await Promise.all([
      this.prisma.order.aggregate({ where: paid, _sum: { total: true, subtotal: true, discount: true, shippingFee: true }, _count: { _all: true } }),
      this.revenue(from, to),
      this.prisma.order.aggregate({ where: { status: "CANCELED", paidAt: { not: null }, canceledAt: { gte: from, lt: to } }, _sum: { total: true }, _count: { _all: true } }),
      ledgerSum("TOP_UP"),
      this.prisma.withdrawal.aggregate({ where: { status: "SUCCESSFUL", completedAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.withdrawal.aggregate({ where: { status: "FAILED", completedAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: { _all: true } }),
      ledgerSum("ADJUSTMENT", "in"),
      ledgerSum("ADJUSTMENT", "out"),
      ledgerSum("SALE"),
      this.prisma.payment.groupBy({ by: ["method"], where: { status: "SUCCESSFUL", paidAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      this.prisma.walletTransaction.aggregate({ where: { status: "PENDING" }, _sum: { amount: true } }),
    ]);
    return {
      from,
      to,
      sales: {
        orders: orders._count._all,
        gmv: num(orders._sum.total),
        items: num(orders._sum.subtotal),
        discounts: num(orders._sum.discount),
        deliveryFees: num(orders._sum.shippingFee),
      },
      revenue: rev,
      refunds: { count: canceled._count._all, amount: num(canceled._sum.total) },
      wallet: {
        topUps: { count: topUps._count._all, amount: num(topUps._sum.amount) },
        sellerEarnings: { count: payouts._count._all, amount: num(payouts._sum.amount) },
        withdrawalsPaid: { count: withdrawn._count._all, amount: num(withdrawn._sum.amount) },
        withdrawalsFailed: { count: withdrawReturned._count._all, amount: num(withdrawReturned._sum.amount) },
        adjustmentsIn: num(adjustIn._sum.amount),
        adjustmentsOut: -num(adjustOut._sum.amount),
        balancesNow: num(balances._sum.balance),
        heldNow: num(held._sum.amount),
      },
      paymentsByMethod: byMethod.map((m) => ({ method: m.method, count: m._count._all, amount: num(m._sum.amount) })),
    };
  }

  async payments(q: AdminPaymentsQuery) {
    const p = q.page ?? 1;
    const where: Prisma.PaymentWhereInput = {
      ...(q.status ? { status: q.status.toUpperCase() as Prisma.PaymentWhereInput["status"] } : {}),
      ...(q.purpose ? { purpose: q.purpose.toUpperCase() as Prisma.PaymentWhereInput["purpose"] } : {}),
      ...(q.q
        ? {
            OR: [
              { reference: { contains: q.q, mode: "insensitive" } },
              { providerTxId: { contains: q.q } },
              { user: { email: { contains: q.q, mode: "insensitive" } } },
              { orders: { some: { id: q.q } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * PAGE,
        take: PAGE,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } }, orders: { select: { id: true, status: true } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return page(
      rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        purpose: lower(r.purpose),
        method: r.method,
        provider: r.provider,
        providerTxId: r.providerTxId,
        amount: num(r.amount),
        status: lower(r.status),
        failureReason: r.failureReason,
        user: { id: r.user.id, name: fullName(r.user), email: r.user.email },
        orders: r.orders.map((o) => ({ id: o.id, status: lower(o.status) })),
        paidAt: r.paidAt,
        createdAt: r.createdAt,
      })),
      total,
      p,
    );
  }

  async ledger(q: AdminLedgerQuery) {
    const p = q.page ?? 1;
    const where: Prisma.WalletTransactionWhereInput = {
      ...(q.type ? { type: q.type.toUpperCase() as Prisma.WalletTransactionWhereInput["type"] } : {}),
      ...(q.q
        ? {
            OR: [
              { reference: { contains: q.q, mode: "insensitive" } },
              { description: { contains: q.q, mode: "insensitive" } },
              { orderId: q.q },
              { wallet: { user: { email: { contains: q.q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * PAGE,
        take: PAGE,
        include: { wallet: { select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } } },
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    return page(
      rows.map((t) => ({
        id: t.id,
        type: lower(t.type),
        status: lower(t.status),
        amount: num(t.amount),
        reference: t.reference,
        description: t.description,
        orderId: t.orderId,
        availableAt: t.availableAt,
        user: { id: t.wallet.user.id, name: fullName(t.wallet.user), email: t.wallet.user.email },
        createdAt: t.createdAt,
      })),
      total,
      p,
    );
  }

  /** CSV downloads for the accountant (up to 50,000 rows per file). */
  async export(kind: string, fromIso?: string, toIso?: string): Promise<{ filename: string; csv: string }> {
    const { from, to } = this.range(fromIso, toIso);
    const span = `${from.toISOString().slice(0, 10)}_to_${new Date(to.getTime() - 1).toISOString().slice(0, 10)}`;
    const take = 50_000;
    const when = { gte: from, lt: to };
    switch (kind) {
      case "orders": {
        const rows = await this.prisma.order.findMany({
          where: { createdAt: when, status: { not: "AWAITING_PAYMENT" } },
          orderBy: { createdAt: "asc" },
          take,
          include: { buyer: { select: { email: true } }, seller: { select: { email: true } }, payment: { select: { reference: true, method: true } }, items: { select: { name: true, qty: true } } },
        });
        return {
          filename: `gbanjo-orders_${span}.csv`,
          csv: toCsv(
            ["Order", "Placed", "Paid", "Status", "Stage", "Buyer", "Seller", "Items", "Subtotal", "Discount", "Delivery fee", "Total", "Commission", "Voucher", "Payment ref", "Method", "Refunded to", "Delivered", "Canceled"],
            rows.map((o) => [
              o.id, o.createdAt, o.paidAt, lower(o.status), o.stage, o.buyer.email, o.seller?.email ?? "Gbanjo",
              o.items.map((i) => `${i.qty}× ${i.name}`).join("; "), num(o.subtotal), num(o.discount), num(o.shippingFee), num(o.total), num(o.platformFee),
              o.voucherCode, o.payment.reference, o.payment.method, o.refundTo, o.deliveredAt, o.canceledAt,
            ]),
          ),
        };
      }
      case "payments": {
        const rows = await this.prisma.payment.findMany({ where: { createdAt: when }, orderBy: { createdAt: "asc" }, take, include: { user: { select: { email: true } } } });
        return {
          filename: `gbanjo-payments_${span}.csv`,
          csv: toCsv(
            ["Reference", "Created", "Paid", "Purpose", "Method", "Provider", "Provider tx", "Amount", "Status", "Customer", "Failure"],
            rows.map((p) => [p.reference, p.createdAt, p.paidAt, lower(p.purpose), p.method, p.provider, p.providerTxId, num(p.amount), lower(p.status), p.user.email, p.failureReason]),
          ),
        };
      }
      case "ledger": {
        const rows = await this.prisma.walletTransaction.findMany({ where: { createdAt: when }, orderBy: { createdAt: "asc" }, take, include: { wallet: { select: { user: { select: { email: true } } } } } });
        return {
          filename: `gbanjo-wallet-ledger_${span}.csv`,
          csv: toCsv(
            ["Date", "Customer", "Type", "Status", "Amount", "Reference", "Description", "Order", "Available"],
            rows.map((t) => [t.createdAt, t.wallet.user.email, lower(t.type), lower(t.status), num(t.amount), t.reference, t.description, t.orderId, t.availableAt]),
          ),
        };
      }
      case "withdrawals": {
        const rows = await this.prisma.withdrawal.findMany({ where: { createdAt: when }, orderBy: { createdAt: "asc" }, take, include: { user: { select: { email: true } } } });
        return {
          filename: `gbanjo-withdrawals_${span}.csv`,
          csv: toCsv(
            ["Reference", "Requested", "Completed", "Customer", "Amount", "Bank", "Account number", "Account name", "Status", "Failure"],
            rows.map((w) => [w.reference, w.createdAt, w.completedAt, w.user.email, num(w.amount), w.bankName, w.accountNumber, w.accountName, lower(w.status), w.failureReason]),
          ),
        };
      }
      case "users": {
        const rows = await this.prisma.user.findMany({
          where: { createdAt: when, status: { not: "DELETED" } },
          orderBy: { createdAt: "asc" },
          take,
          include: { wallet: { select: { balance: true } }, sellerVerification: { select: { status: true } }, _count: { select: { purchases: true, products: true } } },
        });
        return {
          filename: `gbanjo-people_${span}.csv`,
          csv: toCsv(
            ["Joined", "Name", "Email", "Phone", "Status", "Seller", "Orders", "Listings", "Wallet", "Last login"],
            rows.map((u) => [u.createdAt, fullName(u), u.email, u.phone, lower(u.status), u.sellerVerification ? lower(u.sellerVerification.status) : "none", u._count.purchases, u._count.products, num(u.wallet?.balance), u.lastLoginAt]),
          ),
        };
      }
      default:
        throw new AppException(HttpStatus.NOT_FOUND, "UNKNOWN_EXPORT", "Choose orders, payments, ledger, withdrawals or users.");
    }
  }

  // ---------- People ----------

  async userDetail(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        wallet: true,
        sellerVerification: true,
        bankAccount: true,
        _count: { select: { purchases: true, sales: true, products: true, reportsAgainst: true, reviews: true } },
      },
    });
    if (!u) throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "We couldn't find that person.");
    const [purchases, sales, listings, withdrawals, ledger, held, spent, earned, sessions] = await Promise.all([
      this.prisma.order.findMany({ where: { buyerId: id, status: { not: "AWAITING_PAYMENT" } }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.order.findMany({ where: { sellerId: id, status: { not: "AWAITING_PAYMENT" } }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.product.findMany({ where: { sellerId: id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, slug: true, name: true, price: true, status: true, imageUrl: true, removedByAdmin: true } }),
      this.prisma.withdrawal.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
      u.wallet ? this.prisma.walletTransaction.findMany({ where: { walletId: u.wallet.id }, orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([]),
      u.wallet ? this.prisma.walletTransaction.aggregate({ where: { walletId: u.wallet.id, status: "PENDING" }, _sum: { amount: true } }) : Promise.resolve(null),
      this.prisma.order.aggregate({ where: { buyerId: id, status: { in: [...PAID] } }, _sum: { total: true } }),
      this.prisma.order.aggregate({ where: { sellerId: id, status: "COMPLETED" }, _sum: { subtotal: true, platformFee: true } }),
      this.prisma.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    const order = (o: (typeof purchases)[number]) => ({ id: o.id, status: lower(o.status), stage: o.stage, total: num(o.total), createdAt: o.createdAt });
    return {
      id: u.id,
      name: fullName(u),
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
      role: lower(u.role),
      adminRole: u.adminRole,
      status: lower(u.status),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      activeSessions: sessions,
      wallet: { balance: num(u.wallet?.balance), held: num(held?._sum.amount) },
      seller: u.sellerVerification ? { status: lower(u.sellerVerification.status), idType: u.sellerVerification.idType, note: u.sellerVerification.note, submittedAt: u.sellerVerification.createdAt } : null,
      bankAccount: u.bankAccount ? { bankName: u.bankAccount.bankName, accountNumber: `******${u.bankAccount.accountNumber.slice(-4)}`, accountName: u.bankAccount.accountName } : null,
      stats: {
        orders: u._count.purchases,
        spent: num(spent._sum.total),
        sales: u._count.sales,
        earned: round2(num(earned._sum.subtotal) - num(earned._sum.platformFee)),
        listings: u._count.products,
        reviews: u._count.reviews,
        reportsAgainst: u._count.reportsAgainst,
      },
      purchases: purchases.map(order),
      sales: sales.map(order),
      listings: listings.map((l) => ({ id: l.id, slug: l.slug, name: l.name, price: num(l.price), status: l.removedByAdmin ? "hidden" : lower(l.status), image: l.imageUrl })),
      withdrawals: withdrawals.map(toWithdrawalDto),
      ledger: ledger.map((t) => ({ id: t.id, type: lower(t.type), status: lower(t.status), amount: num(t.amount), description: t.description, createdAt: t.createdAt })),
    };
  }

  /** Finance correction: add money to or take money from someone's wallet, with a reason they can see. */
  async adjustWallet(adminId: string, userId: string, amount: number, reason: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!u || u.status === "DELETED") throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "We couldn't find that person.");
    if (userId === adminId) throw new AppException(HttpStatus.BAD_REQUEST, "SELF_ADJUST", "You can't adjust your own wallet. Ask another finance admin.");
    const entry = { userId, amount: Math.abs(amount), type: "ADJUSTMENT" as const, reference: `adjust:${randomUUID()}`, description: `Adjustment by Gbanjo: ${reason}` };
    await this.prisma
      .$transaction(async (tx) => {
        if (amount > 0) await this.wallets.credit(tx, entry);
        else await this.wallets.debit(tx, entry);
      })
      .catch((e: unknown) => {
        if ((e as AppException).code === "INSUFFICIENT_FUNDS") throw new AppException(HttpStatus.BAD_REQUEST, "INSUFFICIENT_FUNDS", "Their wallet doesn't have that much to take away.");
        throw e;
      });
    await this.inbox.notify(userId, {
      type: "account",
      title: amount > 0 ? `₦${amount.toLocaleString("en-NG")} added to your wallet` : `₦${Math.abs(amount).toLocaleString("en-NG")} taken from your wallet`,
      body: reason,
      href: "/profile/wallet/history",
    });
    return this.userDetail(userId);
  }

  private async assertUnique(email: string | undefined, phone: string | null | undefined, exceptId?: string) {
    const fields: Record<string, string> = {};
    if (email && (await this.prisma.user.findFirst({ where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }))) fields.email = "Another account uses this email";
    if (phone && (await this.prisma.user.findFirst({ where: { phone, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }))) fields.phone = "Another account uses this phone number";
    if (Object.keys(fields).length) throw new AppException(HttpStatus.CONFLICT, "ALREADY_USED", Object.values(fields)[0], { fields });
  }

  /** New customer (or, for super admins, a new admin). They can sign in straight away with the password given. */
  async createUser(me: { id: string; adminRole?: string | null }, dto: CreateUserDto) {
    if (dto.adminRole && !areasFor((me.adminRole ?? "SUPER") as AdminRole).includes("team"))
      throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_AREA_FORBIDDEN", "Only a super admin can create admin accounts.");
    await this.assertUnique(dto.email, dto.phone);
    const now = new Date();
    const u = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
        role: dto.adminRole ? "ADMIN" : "USER",
        adminRole: dto.adminRole ?? null,
        emailVerifiedAt: now,
        phoneVerifiedAt: dto.phone ? now : null,
        wallet: { create: {} },
      },
    });
    return this.userDetail(u.id);
  }

  /** Fix someone's name, email, phone or set a new password. Admin accounts can only be edited by super admins. */
  async updateUser(me: { id: string; adminRole?: string | null }, id: string, dto: UpdateUserDto) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { role: true, status: true, phone: true, email: true } });
    if (!u || u.status === "DELETED") throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "We couldn't find that person.");
    if (u.role === "ADMIN" && id !== me.id && !areasFor((me.adminRole ?? "SUPER") as AdminRole).includes("team"))
      throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_AREA_FORBIDDEN", "Only a super admin can edit another admin's account.");
    await this.assertUnique(dto.email !== u.email ? dto.email : undefined, dto.phone !== u.phone ? dto.phone : undefined, id);
    const now = new Date();
    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined && dto.email !== u.email) Object.assign(data, { email: dto.email, emailVerifiedAt: now });
    if (dto.phone !== undefined && dto.phone !== u.phone) Object.assign(data, { phone: dto.phone, phoneVerifiedAt: dto.phone ? now : null });
    if (dto.password) data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data }),
      // New password: sign them out everywhere.
      ...(dto.password && id !== me.id ? [this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokedReason: "password_reset_by_admin" } })] : []),
    ]);
    await this.sessionCache.dropUser(id);
    return this.userDetail(id);
  }

  /** Delete someone's account (same rules as when they delete it themselves). */
  async deleteUser(me: { id: string; adminRole?: string | null }, id: string) {
    if (id === me.id) throw new AppException(HttpStatus.BAD_REQUEST, "SELF_DELETE", "You can't delete your own account here.");
    const u = await this.prisma.user.findUnique({ where: { id }, select: { role: true, adminRole: true, status: true } });
    if (!u || u.status === "DELETED") throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "We couldn't find that person.");
    if (u.role === "ADMIN") {
      if (!areasFor((me.adminRole ?? "SUPER") as AdminRole).includes("team"))
        throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_AREA_FORBIDDEN", "Only a super admin can delete an admin account.");
      const supers = await this.prisma.user.count({ where: { role: "ADMIN", OR: [{ adminRole: "SUPER" }, { adminRole: null }], status: "ACTIVE", id: { not: id } } });
      if (!supers) throw new AppException(HttpStatus.CONFLICT, "LAST_SUPER_ADMIN", "There must always be at least one super admin.");
    }
    await this.users.eraseAccount(id, "admin");
  }

  // ---------- Catalog ----------

  async listings(q: AdminListingsQuery) {
    const p = q.page ?? 1;
    const status: Prisma.ProductWhereInput =
      q.status === "hidden"
        ? { removedByAdmin: true }
        : q.status === "featured"
          ? { featuredScore: { gt: 0 } }
          : q.status
            ? { status: q.status.toUpperCase() as "ACTIVE" | "DRAFT" | "SOLD", removedByAdmin: false }
            : {};
    const where: Prisma.ProductWhereInput = {
      ...status,
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { slug: { contains: q.q, mode: "insensitive" } }, { seller: { email: { contains: q.q, mode: "insensitive" } } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * PAGE,
        take: PAGE,
        include: {
          category: { select: { slug: true, name: true } },
          seller: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { orderItems: true, reports: true, wishlistItems: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return page(rows.map((r) => this.listingView(r)), total, p);
  }

  private listingView(
    r: Prisma.ProductGetPayload<{
      include: { category: { select: { slug: true; name: true } }; seller: { select: { id: true; firstName: true; lastName: true } }; _count: { select: { orderItems: true; reports: true; wishlistItems: true } } };
    }>,
  ) {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      image: r.imageUrl,
      price: num(r.price),
      oldPrice: r.oldPrice === null ? null : num(r.oldPrice),
      status: r.removedByAdmin ? "hidden" : lower(r.status),
      featured: r.featuredScore > 0,
      flashSaleEndsAt: r.flashSaleEndsAt,
      category: r.category,
      seller: r.seller ? { id: r.seller.id, name: fullName(r.seller) } : null,
      rating: num(r.rating),
      reviewCount: r.reviewCount,
      sold: r._count.orderItems,
      saves: r._count.wishlistItems,
      reports: r._count.reports,
      createdAt: r.createdAt,
    };
  }

  /** Everything needed to fill the admin's edit form. */
  async listingDetail(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id }, include: { category: { select: { slug: true, name: true } }, seller: { select: { id: true, firstName: true, lastName: true, email: true } } } });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "We couldn't find that listing.");
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      price: num(p.price),
      oldPrice: p.oldPrice === null ? null : num(p.oldPrice),
      category: p.category,
      condition: p.condition,
      brand: p.brand,
      location: p.location,
      photos: [p.imageUrl, ...p.gallery].filter(Boolean),
      status: p.removedByAdmin ? "hidden" : lower(p.status),
      negotiable: p.negotiable,
      delivery: p.delivery,
      featured: p.featuredScore > 0,
      flashSaleEndsAt: p.flashSaleEndsAt,
      seller: p.seller ? { id: p.seller.id, name: fullName(p.seller), email: p.seller.email } : null,
      createdAt: p.createdAt,
    };
  }

  /** Seller by email (null/"" = Gbanjo's own listing). */
  private async sellerIdFor(email: string | null | undefined): Promise<string | null> {
    if (!email) return null;
    const u = await this.prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
    if (!u || u.status === "DELETED") throw invalidFields({ sellerEmail: "No Gbanjo account uses this email" });
    return u.id;
  }

  private async categoryFor(slug: string) {
    const c = await this.prisma.category.findUnique({ where: { slug } });
    if (!c) throw invalidFields({ category: "Pick a category from the list" });
    return c;
  }

  /** New listing made by the team: Gbanjo's own (no seller) or on behalf of a seller. */
  async createListing(dto: CreateListingDto) {
    const missing: Record<string, string> = {};
    if (!dto.name) missing.name = "Enter a name";
    if (!dto.price) missing.price = "Enter a price";
    if (!dto.category) missing.category = "Pick a category";
    if (!dto.location) missing.location = "Enter a location";
    if (!dto.photos?.length) missing.photos = "Add at least one photo";
    if (Object.keys(missing).length) throw invalidFields(missing);
    const category = await this.categoryFor(dto.category!);
    const sellerId = await this.sellerIdFor(dto.sellerEmail);
    const condition = dto.condition ?? "New";
    const photos = [...new Set(dto.photos!)];
    const p = await this.prisma.product.create({
      data: {
        slug: listingSlug(dto.name!),
        name: dto.name!,
        description: dto.description || null,
        price: dto.price!,
        categoryId: category.id,
        tags: `${category.name} · ${condition}`,
        condition,
        brand: dto.brand || null,
        location: dto.location!,
        imageUrl: photos[0],
        gallery: photos.slice(1),
        variations: [],
        status: dto.status ? (dto.status.toUpperCase() as "ACTIVE" | "DRAFT" | "SOLD") : "ACTIVE",
        negotiable: dto.negotiable ?? false,
        delivery: dto.delivery ?? (sellerId ? "buyer-pays" : null),
        featuredScore: dto.featured ? 10 : 0,
        sellerId,
      },
    });
    return this.listingDetail(p.id);
  }

  /** Edit any part of a listing. Only the fields sent change. */
  async updateListing(id: string, dto: UpdateListingDto) {
    const p = await this.prisma.product.findUnique({ where: { id }, include: { category: true } });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "We couldn't find that listing.");
    const data: Prisma.ProductUncheckedUpdateInput = {};
    const price = dto.price ?? num(p.price);
    if (dto.featured !== undefined) data.featuredScore = dto.featured ? 10 : 0;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description || null;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.brand !== undefined) data.brand = dto.brand || null;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.negotiable !== undefined) data.negotiable = dto.negotiable;
    if (dto.delivery !== undefined) data.delivery = dto.delivery;
    if (dto.photos !== undefined) {
      const photos = [...new Set(dto.photos)];
      data.imageUrl = photos[0];
      data.gallery = photos.slice(1);
    }
    if (dto.category !== undefined || dto.condition !== undefined) {
      const category = dto.category !== undefined ? await this.categoryFor(dto.category) : p.category;
      const condition = dto.condition ?? p.condition ?? "New";
      Object.assign(data, { categoryId: category.id, condition, tags: `${category.name} · ${condition}` });
    }
    if (dto.sellerEmail !== undefined) data.sellerId = await this.sellerIdFor(dto.sellerEmail);
    if (dto.status !== undefined) {
      data.status = dto.status.toUpperCase() as "ACTIVE" | "DRAFT" | "SOLD";
      // Publishing from here also lifts a take-down.
      if (dto.status === "active") data.removedByAdmin = false;
    }
    if (dto.flashSaleEndsAt !== undefined) {
      if (dto.flashSaleEndsAt === null) Object.assign(data, { flashSaleEndsAt: null, oldPrice: null });
      else {
        const ends = new Date(dto.flashSaleEndsAt);
        if (ends <= new Date()) throw new AppException(HttpStatus.BAD_REQUEST, "BAD_DATE", "Pick an end time in the future.", { fields: { flashSaleEndsAt: "Must be in the future" } });
        if (!dto.oldPrice || dto.oldPrice <= price)
          throw new AppException(HttpStatus.BAD_REQUEST, "OLD_PRICE_REQUIRED", "Enter the original price (higher than the sale price).", { fields: { oldPrice: "Must be above the current price" } });
        Object.assign(data, { flashSaleEndsAt: ends, oldPrice: dto.oldPrice });
      }
    } else if (dto.price !== undefined && p.oldPrice !== null && num(p.oldPrice) <= dto.price) {
      // A sale whose "was" price is no longer higher makes no sense: end it.
      Object.assign(data, { flashSaleEndsAt: null, oldPrice: null });
    }
    const r = await this.prisma.product.update({
      where: { id },
      data,
      include: {
        category: { select: { slug: true, name: true } },
        seller: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { orderItems: true, reports: true, wishlistItems: true } },
      },
    });
    return this.listingView(r);
  }

  /** Deletes a listing for good. Past orders keep their own copy of the name, price and photo. */
  async deleteListing(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id }, select: { id: true, name: true, sellerId: true } });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "We couldn't find that listing.");
    const open = await this.prisma.orderItem.count({ where: { productId: id, order: { status: { in: ["AWAITING_PAYMENT", "ONGOING"] } } } });
    if (open) throw new AppException(HttpStatus.CONFLICT, "LISTING_IN_OPEN_ORDER", `${open} order(s) for this listing are still in progress. Take it down instead, or wait until they finish.`);
    await this.prisma.product.delete({ where: { id } });
    if (p.sellerId)
      await this.inbox.notify(p.sellerId, { type: "seller", title: "A listing was removed", body: `"${p.name}" was removed by Gbanjo. Contact support if you think this is a mistake.`, href: "/sell/listings" });
  }

  async categories() {
    const rows = await this.prisma.category.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { products: true } } } });
    const active = await this.prisma.product.groupBy({ by: ["categoryId"], where: { status: "ACTIVE" }, _count: { _all: true } });
    const activeBy = new Map(active.map((a) => [a.categoryId, a._count._all]));
    return rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, blurb: c.blurb, imageUrl: c.imageUrl, sortOrder: c.sortOrder, products: c._count.products, activeProducts: activeBy.get(c.id) ?? 0 }));
  }

  async createCategory(dto: SaveCategoryDto) {
    const slug = dto.slug || slugify(dto.name);
    if (!slug) throw new AppException(HttpStatus.BAD_REQUEST, "BAD_NAME", "Use letters or numbers in the name.");
    if (!dto.imageUrl) throw new AppException(HttpStatus.BAD_REQUEST, "IMAGE_REQUIRED", "Add a picture for the category.", { fields: { imageUrl: "Add a picture" } });
    const exists = await this.prisma.category.findUnique({ where: { slug } });
    if (exists) throw new AppException(HttpStatus.CONFLICT, "CATEGORY_EXISTS", "A category with that name already exists.", { fields: { name: "Already exists" } });
    const max = await this.prisma.category.aggregate({ _max: { sortOrder: true } });
    await this.prisma.category.create({ data: { slug, name: dto.name, blurb: dto.blurb ?? "", imageUrl: dto.imageUrl, sortOrder: dto.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } });
    return this.categories();
  }

  async updateCategory(id: string, dto: SaveCategoryDto) {
    const c = await this.prisma.category.findUnique({ where: { id } });
    if (!c) throw new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That category doesn't exist.");
    // The URL name stays the same once created (links and the app rely on it).
    await this.prisma.category.update({ where: { id }, data: { name: dto.name, blurb: dto.blurb ?? c.blurb, imageUrl: dto.imageUrl ?? c.imageUrl, sortOrder: dto.sortOrder ?? c.sortOrder } });
    return this.categories();
  }

  async deleteCategory(id: string) {
    const c = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!c) throw new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That category doesn't exist.");
    if (c._count.products) throw new AppException(HttpStatus.CONFLICT, "CATEGORY_IN_USE", `${c._count.products} listings use this category. Move or remove them first.`);
    await this.prisma.category.delete({ where: { id } });
  }

  async vouchers() {
    const rows = await this.prisma.voucher.findMany({ orderBy: { createdAt: "desc" } });
    const used = await this.prisma.order.groupBy({ by: ["voucherCode"], where: { voucherCode: { not: null }, status: { in: [...PAID] } }, _sum: { discount: true }, _count: { _all: true } });
    const by = new Map(used.map((u) => [u.voucherCode, u]));
    return rows.map((v) => ({
      code: v.code,
      percentOff: v.percentOff,
      description: v.description,
      active: v.active,
      expiresAt: v.expiresAt,
      expired: !!v.expiresAt && v.expiresAt < new Date(),
      maxUses: v.maxUses,
      usedCount: v.usedCount,
      minOrder: v.minOrder === null ? null : num(v.minOrder),
      paidOrders: by.get(v.code)?._count._all ?? 0,
      discountGiven: num(by.get(v.code)?._sum.discount),
      createdAt: v.createdAt,
    }));
  }

  async createVoucher(dto: SaveVoucherDto) {
    const exists = await this.prisma.voucher.findUnique({ where: { code: dto.code } });
    if (exists) throw new AppException(HttpStatus.CONFLICT, "VOUCHER_EXISTS", "That code already exists.", { fields: { code: "Already exists" } });
    await this.prisma.voucher.create({
      data: {
        code: dto.code,
        percentOff: dto.percentOff,
        description: dto.description ?? "",
        maxUses: dto.maxUses ?? null,
        minOrder: dto.minOrder ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        active: dto.active ?? true,
      },
    });
    return this.vouchers();
  }

  async updateVoucher(code: string, dto: UpdateVoucherDto) {
    const v = await this.prisma.voucher.findUnique({ where: { code: code.toUpperCase() } });
    if (!v) throw new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That voucher doesn't exist.");
    await this.prisma.voucher.update({
      where: { code: v.code },
      data: {
        ...(dto.percentOff !== undefined ? { percentOff: dto.percentOff } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.maxUses !== undefined ? { maxUses: dto.maxUses } : {}),
        ...(dto.minOrder !== undefined ? { minOrder: dto.minOrder } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return this.vouchers();
  }

  async deleteVoucher(code: string) {
    const v = await this.prisma.voucher.findUnique({ where: { code: code.toUpperCase() } });
    if (!v) throw new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That voucher doesn't exist.");
    // Used vouchers stay (orders refer to them) — they're switched off instead.
    if (v.usedCount > 0) await this.prisma.voucher.update({ where: { code: v.code }, data: { active: false } });
    else await this.prisma.voucher.delete({ where: { code: v.code } });
  }

  async reviews(q: { page?: number; q?: string; rating?: number }) {
    const p = q.page ?? 1;
    const where: Prisma.ReviewWhereInput = {
      ...(q.q ? { OR: [{ text: { contains: q.q, mode: "insensitive" } }, { product: { name: { contains: q.q, mode: "insensitive" } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * PAGE,
        take: PAGE,
        include: { user: { select: { id: true, firstName: true, lastName: true } }, product: { select: { slug: true, name: true } } },
      }),
      this.prisma.review.count({ where }),
    ]);
    return page(
      rows.map((r) => ({ id: r.id, rating: r.rating, text: r.text, user: { id: r.user.id, name: fullName(r.user) }, product: { id: r.product.slug, name: r.product.name }, createdAt: r.createdAt })),
      total,
      p,
    );
  }

  // ---------- Team ----------

  async team() {
    const rows = await this.prisma.user.findMany({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, firstName: true, lastName: true, email: true, adminRole: true, status: true, lastLoginAt: true } });
    return rows.map((u) => ({ id: u.id, name: fullName(u), email: u.email, adminRole: u.adminRole ?? "SUPER", status: lower(u.status), lastLoginAt: u.lastLoginAt }));
  }

  async addAdmin(email: string, adminRole: AdminRole) {
    const u = await this.prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
    if (!u || u.status === "DELETED")
      throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "No Gbanjo account uses that email. Ask them to sign up first.", { fields: { email: "No account with this email" } });
    if (u.status !== "ACTIVE") throw new AppException(HttpStatus.BAD_REQUEST, "USER_SUSPENDED", "That account is suspended. Reactivate it first.");
    await this.prisma.user.update({ where: { id: u.id }, data: { role: "ADMIN", adminRole } });
    await this.sessionCache.dropUser(u.id);
    return this.team();
  }

  async setAdminRole(me: string, id: string, adminRole: AdminRole | null) {
    if (id === me) throw new AppException(HttpStatus.BAD_REQUEST, "SELF_ROLE", "You can't change your own admin role. Ask another super admin.");
    const target = await this.prisma.user.findUnique({ where: { id }, select: { role: true, adminRole: true } });
    if (!target || target.role !== "ADMIN") throw new AppException(HttpStatus.NOT_FOUND, "NOT_AN_ADMIN", "That person isn't an admin.");
    // Never leave the business without a super admin.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: adminRole ? { adminRole } : { role: "USER", adminRole: null } });
      const supers = await tx.user.count({ where: { role: "ADMIN", OR: [{ adminRole: "SUPER" }, { adminRole: null }], status: "ACTIVE" } });
      if (!supers) throw new AppException(HttpStatus.CONFLICT, "LAST_SUPER_ADMIN", "There must always be at least one super admin.");
    });
    await this.sessionCache.dropUser(id);
    return this.team();
  }

  async audit(q: { page?: number; q?: string }) {
    const p = q.page ?? 1;
    const where: Prisma.AdminAuditLogWhereInput = q.q
      ? { OR: [{ summary: { contains: q.q, mode: "insensitive" } }, { adminName: { contains: q.q, mode: "insensitive" } }, { targetId: q.q }] }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p - 1) * PAGE, take: PAGE }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return page(rows.map((r) => ({ id: r.id, admin: { id: r.adminId, name: r.adminName }, action: r.action, summary: r.summary, targetId: r.targetId, details: r.details, ip: r.ipAddress, createdAt: r.createdAt })), total, p);
  }

  // ---------- Announcements ----------

  async broadcast(dto: BroadcastDto) {
    const base: Prisma.UserWhereInput = { status: "ACTIVE" };
    const where: Prisma.UserWhereInput =
      dto.audience === "sellers" ? { ...base, OR: [{ products: { some: {} } }, { sellerVerification: { isNot: null } }] } : dto.audience === "buyers" ? { ...base, purchases: { some: {} } } : base;
    const ids = (await this.prisma.user.findMany({ where, select: { id: true } })).map((u) => u.id);
    if (!ids.length) throw new AppException(HttpStatus.BAD_REQUEST, "NO_AUDIENCE", "Nobody matches that audience yet.");
    const r = await this.inbox.broadcast(ids, { type: dto.kind, title: dto.title, body: dto.body, href: dto.href });
    return { audience: dto.audience, ...r };
  }

  async audienceSizes() {
    const base: Prisma.UserWhereInput = { status: "ACTIVE" };
    const [everyone, buyers, sellers] = await Promise.all([
      this.prisma.user.count({ where: base }),
      this.prisma.user.count({ where: { ...base, purchases: { some: {} } } }),
      this.prisma.user.count({ where: { ...base, OR: [{ products: { some: {} } }, { sellerVerification: { isNot: null } }] } }),
    ]);
    return { everyone, buyers, sellers };
  }
}
