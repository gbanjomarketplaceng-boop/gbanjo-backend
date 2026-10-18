import { HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { InboxService } from "../inbox/inbox.service";
import { toWithdrawalDto } from "../payments/withdrawals.service";
import type { AdminReportDto, AdminUserDto, OverviewDto } from "./dto/admin.dto";

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const lower = <T extends string>(s: T) => s.toLowerCase();

/** Admin tools that don't belong to one feature: overview counts, people, reports, hiding listings, withdrawals. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: InboxService,
  ) {}

  async overview(): Promise<OverviewDto> {
    const [users, pendingVerifications, openReports, newContactMessages, ongoingOrders, pendingWithdrawals] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: "DELETED" } } }),
      this.prisma.sellerVerification.count({ where: { status: "PENDING" } }),
      this.prisma.report.count({ where: { status: "OPEN" } }),
      this.prisma.contactMessage.count({ where: { status: "NEW" } }),
      this.prisma.order.count({ where: { status: "ONGOING" } }),
      this.prisma.withdrawal.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    ]);
    return { users, pendingVerifications, openReports, newContactMessages, ongoingOrders, pendingWithdrawals };
  }

  async users(q?: string, status?: "active" | "suspended" | "deleted"): Promise<AdminUserDto[]> {
    const term = q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(status ? { status: status.toUpperCase() as "ACTIVE" | "SUSPENDED" | "DELETED" } : {}),
      ...(term
        ? {
            OR: [
              { firstName: { contains: term, mode: "insensitive" } },
              { lastName: { contains: term, mode: "insensitive" } },
              { email: { contains: term, mode: "insensitive" } },
              { phone: { contains: term.replace(/\s/g, "") } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sellerVerification: { select: { status: true } },
        _count: { select: { products: true, purchases: true, reportsAgainst: true } },
      },
    });
    return rows.map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.email,
      phone: u.phone,
      role: lower(u.role),
      status: lower(u.status),
      seller: u.sellerVerification ? lower(u.sellerVerification.status) : "none",
      listings: u._count.products,
      orders: u._count.purchases,
      reports: u._count.reportsAgainst,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  async setUserStatus(adminId: string, id: string, status: "active" | "suspended") {
    if (id === adminId) throw new AppException(HttpStatus.BAD_REQUEST, "SELF_SUSPEND", "You can't suspend your own account.");
    const u = await this.prisma.user.findUnique({ where: { id }, select: { status: true } });
    if (!u || u.status === "DELETED") throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "We couldn't find that person.");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: status === "active" ? "ACTIVE" : "SUSPENDED" } }),
      ...(status === "suspended"
        ? [this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "suspended" } })]
        : []),
    ]);
    return (await this.users(undefined)).find((x) => x.id === id) ?? null;
  }

  async reports(status?: "open" | "resolved" | "dismissed"): Promise<AdminReportDto[]> {
    const rows = await this.prisma.report.findMany({
      where: status ? { status: status.toUpperCase() as "OPEN" | "RESOLVED" | "DISMISSED" } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        reporter: { select: { id: true, firstName: true, lastName: true } },
        product: { select: { slug: true, name: true, status: true, imageUrl: true } },
        targetUser: { select: { id: true, firstName: true, lastName: true, status: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.targetType,
      reason: r.reason,
      details: r.details,
      status: lower(r.status),
      note: r.note,
      reporter: { id: r.reporter.id, name: fullName(r.reporter) },
      product: r.product ? { id: r.product.slug, name: r.product.name, status: lower(r.product.status), image: r.product.imageUrl } : null,
      user: r.targetUser ? { id: r.targetUser.id, name: fullName(r.targetUser), status: lower(r.targetUser.status) } : null,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }));
  }

  async updateReport(id: string, status: "resolved" | "dismissed" | "open", note?: string) {
    const r = await this.prisma.report
      .update({ where: { id }, data: { status: status.toUpperCase() as "OPEN" | "RESOLVED" | "DISMISSED", note: note ?? undefined, resolvedAt: status === "open" ? null : new Date() } })
      .catch(() => null);
    if (!r) throw new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That report doesn't exist.");
    return (await this.reports()).find((x) => x.id === id);
  }

  /** Takes a listing off the site (or puts it back). The seller is told. */
  async setProductStatus(slug: string, status: "active" | "hidden") {
    const p = await this.prisma.product.findUnique({ where: { slug }, select: { id: true, name: true, sellerId: true, status: true } });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "We couldn't find that listing.");
    if (p.status === "SOLD" && status === "active") throw new AppException(HttpStatus.BAD_REQUEST, "SOLD", "That listing is sold.");
    await this.prisma.product.update({ where: { id: p.id }, data: { status: status === "active" ? "ACTIVE" : "DRAFT", removedByAdmin: status === "hidden" } });
    if (status === "hidden")
      await this.inbox.notify(p.sellerId, {
        type: "seller",
        title: "A listing was taken down",
        body: `"${p.name}" was removed for breaking Gbanjo's rules. Contact support if you think this is a mistake.`,
        href: "/sell/listings",
      });
    return { id: slug, status };
  }

  async withdrawals(status?: "pending" | "processing" | "successful" | "failed") {
    const rows = await this.prisma.withdrawal.findMany({
      where: status ? { status: status.toUpperCase() as "PENDING" | "PROCESSING" | "SUCCESSFUL" | "FAILED" } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    return rows.map((w) => ({ ...toWithdrawalDto(w), user: { id: w.user.id, name: fullName(w.user), email: w.user.email } }));
  }
}
