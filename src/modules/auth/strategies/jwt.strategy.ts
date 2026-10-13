import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Env } from "../../../config/env.validation";
import { PrismaService } from "../../../prisma/prisma.service";
import type { AuthUser, JwtPayload } from "../types/auth-user";

/**
 * Validates `Authorization: Bearer <access token>` and checks the session is still live,
 * so logout / password reset take effect immediately instead of when the JWT expires.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get("JWT_ACCESS_SECRET", { infer: true }),
      algorithms: ["HS256"],
      issuer: "gbanjo-api",
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true, role: true } } },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date() || session.user.status !== "ACTIVE")
      throw new UnauthorizedException();
    return { id: payload.sub, role: session.user.role, sessionId: payload.sid };
  }
}
