import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { AppException } from "../../../common/exceptions/app.exception";
import type { Env } from "../../../config/env.validation";

export type OAuthProviderName = "GOOGLE" | "APPLE";

/** What we trust from a verified Google / Apple ID token. */
export interface OAuthIdentity {
  provider: OAuthProviderName;
  /** The provider's stable user id (`sub`). */
  providerUserId: string;
  /** Lower-cased. Only present when the provider says it's verified. */
  email?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";

const invalidToken = (provider: string) =>
  new AppException(HttpStatus.UNAUTHORIZED, "INVALID_OAUTH_TOKEN", `We couldn't confirm your ${provider} sign-in. Please try again.`);

const notConfigured = (provider: string) =>
  new AppException(HttpStatus.SERVICE_UNAVAILABLE, "OAUTH_NOT_CONFIGURED", `${provider} sign-in isn't available yet. Use your email or phone number for now.`);

/** `true`, `"true"` → true (Apple sends strings). */
const isTrue = (v: unknown) => v === true || v === "true";

/**
 * Verifies ID tokens from Google and Apple against their published signing keys (JWKS),
 * checking signature, issuer, audience and expiry. Keys are fetched once and cached by jose.
 */
@Injectable()
export class OAuthVerifierService {
  private readonly logger = new Logger(OAuthVerifierService.name);
  private readonly googleClientId?: string;
  private readonly googleClientSecret?: string;
  private readonly appleAudiences: string[];
  private readonly googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  private readonly appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

  constructor(config: ConfigService<Env, true>) {
    this.googleClientId = config.get("GOOGLE_CLIENT_ID", { infer: true });
    this.googleClientSecret = config.get("GOOGLE_CLIENT_SECRET", { infer: true });
    this.appleAudiences = config
      .get("APPLE_CLIENT_IDS", { infer: true })
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Google: either an ID token (mobile) or an authorization code from the web popup (`redirect_uri=postmessage`). */
  async google(input: { idToken?: string; code?: string }): Promise<OAuthIdentity> {
    if (!this.googleClientId) throw notConfigured("Google");
    const idToken = input.idToken ?? (input.code ? await this.exchangeGoogleCode(input.code) : undefined);
    if (!idToken) throw invalidToken("Google");

    const claims = await this.verify(idToken, this.googleKeys, { issuer: GOOGLE_ISSUERS, audience: this.googleClientId }, "Google");
    const email = typeof claims.email === "string" && isTrue(claims.email_verified) ? claims.email.trim().toLowerCase() : undefined;
    return {
      provider: "GOOGLE",
      providerUserId: claims.sub!,
      email,
      firstName: typeof claims.given_name === "string" ? claims.given_name : undefined,
      lastName: typeof claims.family_name === "string" ? claims.family_name : undefined,
      avatarUrl: typeof claims.picture === "string" ? claims.picture : undefined,
    };
  }

  /** Apple: the identity token from Sign in with Apple. Apple only sends the name to the app, on the first sign-in. */
  async apple(input: { idToken: string; firstName?: string; lastName?: string }): Promise<OAuthIdentity> {
    if (!this.appleAudiences.length) throw notConfigured("Apple");
    const claims = await this.verify(input.idToken, this.appleKeys, { issuer: APPLE_ISSUER, audience: this.appleAudiences }, "Apple");
    const email = typeof claims.email === "string" && isTrue(claims.email_verified) ? claims.email.trim().toLowerCase() : undefined;
    return { provider: "APPLE", providerUserId: claims.sub!, email, firstName: input.firstName, lastName: input.lastName };
  }

  private async verify(
    token: string,
    keys: ReturnType<typeof createRemoteJWKSet>,
    opts: { issuer: string | string[]; audience: string | string[] },
    provider: string,
  ): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, keys, { ...opts, algorithms: ["RS256"], clockTolerance: 30 });
      if (!payload.sub) throw new Error("no sub");
      return payload;
    } catch (e) {
      this.logger.warn(`${provider} token rejected: ${(e as Error).message}`);
      throw invalidToken(provider);
    }
  }

  private async exchangeGoogleCode(code: string): Promise<string> {
    if (!this.googleClientSecret) throw notConfigured("Google");
    let res: Response;
    try {
      res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: this.googleClientId!,
          client_secret: this.googleClientSecret,
          redirect_uri: "postmessage",
          grant_type: "authorization_code",
        }),
      });
    } catch (e) {
      this.logger.error(`Google token endpoint unreachable: ${(e as Error).message}`);
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, "OAUTH_UNAVAILABLE", "Google sign-in is unavailable right now. Please try again shortly.");
    }
    const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !data.id_token) {
      this.logger.warn(`Google code exchange failed: ${data.error ?? res.status} ${data.error_description ?? ""}`);
      throw invalidToken("Google");
    }
    return data.id_token;
  }
}
