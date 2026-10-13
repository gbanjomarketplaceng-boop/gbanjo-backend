import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AppException } from "../../../common/exceptions/app.exception";
import type { ClientInfo } from "../../../common/decorators/client-info.decorator";
import { randomToken, safeEqualHex, sha256 } from "../../../common/utils/crypto";
import type { Env } from "../../../config/env.validation";
import type { User } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { REFRESH_REUSE_GRACE_SECONDS } from "../auth.constants";
import type { AuthTokensDto } from "../dto/responses.dto";
import type { JwtPayload } from "../types/auth-user";

const invalidRefresh = () => new AppException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Your session has expired. Please log in again.");

/**
 * Issues short-lived JWT access tokens and long-lived, rotating refresh tokens backed by the sessions table.
 * Refresh token format: `<sessionId>.<secret>`; only SHA-256(secret) is stored.
 */
@Injectable()
export class TokenService {
  private readonly accessTtl: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get("JWT_ACCESS_TTL_SECONDS", { infer: true });
    this.refreshTtlMs = config.get("REFRESH_TOKEN_TTL_DAYS", { infer: true }) * 86_400_000;
  }

  /** Starts a new session (one per device sign-in). */
  async createSession(user: Pick<User, "id" | "role">, client: ClientInfo): Promise<AuthTokensDto> {
    const secret = randomToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(secret),
        userAgent: client.userAgent,
        ipAddress: client.ip,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
    return this.tokens(user, session.id, secret, session.expiresAt);
  }

  /** Exchanges a refresh token for a new pair. Detects reuse of an old token and revokes the session if so. */
  async rotate(refreshToken: string, client: ClientInfo): Promise<{ userId: string; tokens: AuthTokensDto }> {
    const { sessionId, secret } = this.parse(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== "ACTIVE") throw invalidRefresh();

    const presented = sha256(secret);
    if (safeEqualHex(presented, session.tokenHash)) {
      const next = randomToken();
      // Compare-and-swap so two parallel refreshes with the same token can't both succeed.
      const { count } = await this.prisma.session.updateMany({
        where: { id: session.id, tokenHash: presented, revokedAt: null },
        data: {
          tokenHash: sha256(next),
          previousTokenHash: presented,
          rotatedAt: new Date(),
          lastUsedAt: new Date(),
          ipAddress: client.ip ?? session.ipAddress,
          userAgent: client.userAgent ?? session.userAgent,
        },
      });
      if (count === 1) return { userId: session.userId, tokens: this.tokens(session.user, session.id, next, session.expiresAt) };
      throw this.rotatedError();
    }

    if (session.previousTokenHash && safeEqualHex(presented, session.previousTokenHash)) {
      const recentlyRotated = session.rotatedAt && Date.now() - session.rotatedAt.getTime() < REFRESH_REUSE_GRACE_SECONDS * 1000;
      if (recentlyRotated) throw this.rotatedError();
      // An old token came back after the grace window: treat the session as stolen.
      await this.revokeSession(session.id, "refresh_token_reuse");
    }
    throw invalidRefresh();
  }

  /** Logout: revokes the session the refresh token belongs to. Silently ignores unknown tokens. */
  async revokeByRefreshToken(refreshToken: string) {
    let parsed: { sessionId: string; secret: string };
    try {
      parsed = this.parse(refreshToken);
    } catch {
      return;
    }
    const session = await this.prisma.session.findUnique({ where: { id: parsed.sessionId } });
    if (!session || session.revokedAt) return;
    const h = sha256(parsed.secret);
    const matches = safeEqualHex(h, session.tokenHash) || (!!session.previousTokenHash && safeEqualHex(h, session.previousTokenHash));
    if (matches) await this.revokeSession(session.id, "logout");
  }

  revokeSession(id: string, reason: string) {
    return this.prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  revokeAllForUser(userId: string, reason: string, exceptSessionId?: string) {
    return this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private tokens(user: Pick<User, "id" | "role">, sessionId: string, secret: string, expiresAt: Date): AuthTokensDto {
    const payload: JwtPayload = { sub: user.id, role: user.role, sid: sessionId };
    return {
      tokenType: "Bearer",
      accessToken: this.jwt.sign(payload, { expiresIn: this.accessTtl }),
      accessTokenExpiresIn: this.accessTtl,
      refreshToken: `${sessionId}.${secret}`,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  private parse(token: string) {
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) throw invalidRefresh();
    return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) };
  }

  private rotatedError() {
    return new AppException(HttpStatus.UNAUTHORIZED, "TOKEN_ROTATED", "This session was just refreshed. Retry with the newest refresh token.");
  }
}
