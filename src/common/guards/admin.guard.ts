import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_AREA, type AdminArea, areasFor } from "../admin/admin-areas";
import { AppException } from "../exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser } from "../../modules/auth/types/auth-user";

/**
 * Use after the (global) JWT guard: only users with role ADMIN get through, and only into the parts of the
 * panel their admin role allows (see ROLE_AREAS). Read fresh from the database on every call, so granting or
 * removing access takes effect at once.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser & { adminRole?: string; adminName?: string } }>();
    const id = req.user?.id;
    const row = id ? await this.prisma.user.findUnique({ where: { id }, select: { role: true, status: true, adminRole: true, firstName: true, lastName: true } }) : null;
    if (row?.role !== "ADMIN" || row.status !== "ACTIVE") throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_ONLY", "Only Gbanjo admins can do this.");
    const needed = this.reflector.getAllAndOverride<AdminArea[] | undefined>(ADMIN_AREA, [context.getHandler(), context.getClass()]);
    const allowed = areasFor(row.adminRole);
    if (needed?.length && !needed.some((a) => allowed.includes(a)))
      throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_AREA_FORBIDDEN", "Your admin role doesn't include this. Ask a super admin for access.");
    req.user!.role = "ADMIN";
    req.user!.adminRole = row.adminRole ?? "SUPER";
    req.user!.adminName = `${row.firstName} ${row.lastName}`.trim();
    return true;
  }
}
