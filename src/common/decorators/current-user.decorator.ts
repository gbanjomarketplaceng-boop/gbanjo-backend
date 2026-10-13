import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "../../modules/auth/types/auth-user";

/** The signed-in user attached by JwtStrategy: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
