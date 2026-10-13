import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../exceptions/app.exception";
import type { AuthUser } from "../../modules/auth/types/auth-user";

/** Use after the (global) JWT guard: only users with role ADMIN get through. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (user?.role !== "ADMIN") throw new AppException(HttpStatus.FORBIDDEN, "ADMIN_ONLY", "Only Gbanjo admins can do this.");
    return true;
  }
}
