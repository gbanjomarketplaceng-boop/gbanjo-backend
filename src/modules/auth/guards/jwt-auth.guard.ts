import { ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { AppException } from "../../../common/exceptions/app.exception";

/** Global guard: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    return isPublic ? true : super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T, info?: { name?: string }): T {
    if (info?.name === "TokenExpiredError")
      throw new AppException(HttpStatus.UNAUTHORIZED, "TOKEN_EXPIRED", "Your session needs refreshing.");
    if (err || !user) throw new AppException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Please log in to continue.");
    return user;
  }
}
