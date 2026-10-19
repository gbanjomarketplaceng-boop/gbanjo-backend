import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import type { Request } from "express";
import { tap } from "rxjs";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";

type AdminRequest = Request & { user?: AuthUser & { adminName?: string } };

/** Plain-English line for each admin change (shown in Admin → Activity). */
const SUMMARIES: [RegExp, string, (b: Record<string, unknown>) => string][] = [
  [/^PATCH admin\/users\/:id$/, "", (b) => (b.status === "suspended" ? "Suspended an account" : "Reactivated an account")],
  [/^POST admin\/users$/, "", (b) => `Created ${b.adminRole ? `a ${String(b.adminRole).toLowerCase()} admin` : "an"} account for ${String(b.email).trim().toLowerCase()}`],
  [/^PATCH admin\/users\/:id\/details$/, "", (b) => `Edited an account (${Object.keys(b).map((k) => (k === "password" ? "new password" : k)).join(", ")})`],
  [/^DELETE admin\/users\/:id$/, "", () => "Deleted an account"],
  [/^POST admin\/listings$/, "", (b) => `Created the listing "${String(b.name)}"`],
  [/^DELETE admin\/listings\/:id$/, "", () => "Deleted a listing"],
  [/^POST admin\/users\/:id\/wallet-adjustments$/, "", (b) => `Adjusted a wallet by ₦${Number(b.amount).toLocaleString("en-NG")}: ${String(b.reason ?? "")}`],
  [/^PUT admin\/team$/, "", (b) => `Gave ${String(b.email)} the ${String(b.adminRole).toLowerCase()} admin role`],
  [/^PATCH admin\/team\/:id$/, "", (b) => (b.adminRole ? `Changed an admin's role to ${String(b.adminRole).toLowerCase()}` : "Removed an admin")],
  [/^PATCH admin\/settings$/, "", (b) => `Changed settings: ${Object.keys(b).join(", ")}`],
  [/^PATCH admin\/products\/:slug$/, "", (b) => (b.status === "hidden" ? "Took a listing down" : "Put a listing back")],
  [/^PATCH admin\/listings\/:id$/, "", () => "Edited a listing"],
  [/^POST admin\/categories$/, "", (b) => `Added the category "${String(b.name)}"`],
  [/^PATCH admin\/categories\/:id$/, "", () => "Edited a category"],
  [/^DELETE admin\/categories\/:id$/, "", () => "Deleted a category"],
  [/^POST admin\/vouchers$/, "", (b) => `Created voucher ${String(b.code).toUpperCase()}`],
  [/^PATCH admin\/vouchers\/:code$/, "", () => "Edited a voucher"],
  [/^DELETE admin\/vouchers\/:code$/, "", () => "Deleted a voucher"],
  [/^POST admin\/withdrawals\/:id\/approve$/, "", () => "Approved a withdrawal"],
  [/^POST admin\/withdrawals\/:id\/reject$/, "", (b) => `Rejected a withdrawal: ${String(b.reason ?? "")}`],
  [/^POST admin\/broadcasts$/, "", (b) => `Sent "${String(b.title)}" to ${String(b.audience ?? "everyone")}`],
  [/^PATCH admin\/reports\/:id$/, "", (b) => `Marked a report ${String(b.status)}`],
  [/^PATCH admin\/seller-verifications\/:id$/, "", (b) => (b.status === "VERIFIED" ? "Approved a seller ID" : `Rejected a seller ID${b.note ? `: ${String(b.note)}` : ""}`)],
  [/^(POST|PATCH|DELETE) admin\/banners/, "", () => "Changed the home banners"],
  [/^DELETE admin\/reviews\/:id$/, "", () => "Removed a review"],
  [/^PATCH admin\/contact-messages\/:id$/, "", (b) => (b.status === "RESOLVED" ? "Marked a contact message resolved" : "Reopened a contact message")],
  [/^POST orders\/:id\/advance$/, "", () => "Moved an order to its next stage"],
  [/^POST orders\/:id\/cancel$/, "", () => "Canceled an order (refunded)"],
];

const SECRET = /password|secret|token/i;
const clean = (body: unknown): Prisma.InputJsonValue => {
  if (!body || typeof body !== "object") return {};
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([k]) => !SECRET.test(k)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 500) : (v as Prisma.InputJsonValue)]));
};

/** Records every successful change an admin makes (who, what, when, from where). Never blocks the request. */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger("AdminAudit");
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    if (ctx.getType() !== "http") return next.handle();
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    if (req.method === "GET" || req.user?.role !== "ADMIN") return next.handle();
    const route = String((req.route as { path?: string } | undefined)?.path ?? req.path).replace(/^\/?api\/?/, "").replace(/^v\d+\//, "").replace(/^\//, "");
    const action = `${req.method} ${route}`;
    const match = SUMMARIES.find(([re]) => re.test(action));
    if (!match && !route.startsWith("admin/")) return next.handle();
    const body = (req.body ?? {}) as Record<string, unknown>;
    return next.handle().pipe(
      tap(() => {
        void this.write(req, action, match ? match[2](body) : action, body).catch((e: unknown) => this.logger.warn(`audit: ${(e as Error).message}`));
      }),
    );
  }

  private async write(req: AdminRequest, action: string, summary: string, body: unknown) {
    const id = req.user!.id;
    let name = req.user!.adminName;
    if (!name) {
      const u = await this.prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true } });
      name = u ? `${u.firstName} ${u.lastName}`.trim() : "Admin";
    }
    const params = req.params as Record<string, string>;
    await this.prisma.adminAuditLog.create({
      data: { adminId: id, adminName: name, action, summary, targetId: params.id ?? params.slug ?? params.code ?? null, details: clean(body), ipAddress: req.ip ?? null },
    });
  }
}
