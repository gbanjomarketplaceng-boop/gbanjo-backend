import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthUser } from "../../modules/auth/types/auth-user";

/**
 * Use after the (global) JWT guard: only users with role ADMIN get through. The role is read fresh from
 * the database (admin pages are rare), so granting or removing admin rights takes effect at once.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const id = req.user?.id;
    const row = id ? await this.prisma.user.findUnique({ where: { id }, select: { role: true, status: true } }) : null;
    if (row?.role !== "ADMIN" || row.status !== "ACTIVE") throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_ONLY", "Only Gbanjo admins can do this.");
    req.user!.role = "ADMIN";
    return true;
  }
}
