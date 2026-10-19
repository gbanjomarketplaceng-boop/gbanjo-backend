import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Env } from "../../../config/env.validation";
import { SessionCacheService } from "../../../common/cache/session-cache.service";
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
    private readonly sessions: SessionCacheService,
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
    let s = await this.sessions.get(payload.sid, payload.sub);
    if (!s) {
      const row = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true, role: true } } },
      });
      if (!row) throw new UnauthorizedException();
      s = { userId: row.userId, role: row.user.role, status: row.user.status, revoked: !!row.revokedAt, expiresAt: row.expiresAt.getTime() };
      await this.sessions.set(payload.sid, s);
    }
    if (s.userId !== payload.sub || s.revoked || s.expiresAt < Date.now() || s.status !== "ACTIVE") throw new UnauthorizedException();
    return { id: payload.sub, role: s.role, sessionId: payload.sid };
  }
}
