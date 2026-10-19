import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import Redis from "ioredis";
import type { ClientInfo } from "../../common/decorators/client-info.decorator";
import { AppException } from "../../common/exceptions/app.exception";
import { randomToken, sha256 } from "../../common/utils/crypto";
import { maskEmail, maskPhone, normalizeNigerianPhone } from "../../common/utils/phone";
import type { User } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { REDIS } from "../../redis/redis.constants";
import { NotificationsService } from "../notifications/notifications.service";
import { UserResponseDto } from "../users/dto/user-response.dto";
import { UsersService } from "../users/users.service";
import { RESET_TOKEN_TTL_SECONDS } from "./auth.constants";
import type {
  AppleSignInDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleSignInDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyPhoneDto,
  VerifyResetCodeDto,
} from "./dto/requests.dto";
import type {
  AuthResponseDto,
  ForgotPasswordResponseDto,
  LookupResponseDto,
  OAuthResultDto,
  RegisterResponseDto,
  ResetTokenResponseDto,
  SignupCodeDto,
} from "./dto/responses.dto";
import { LoginAttemptsService } from "./services/login-attempts.service";
import { OAuthVerifierService, type OAuthIdentity, type OAuthProviderName } from "./services/oauth-verifier.service";
import { OtpService } from "./services/otp.service";
import { PasswordService } from "./services/password.service";
import { TokenService } from "./services/token.service";

const providerLabel = (p: OAuthProviderName) => (p === "GOOGLE" ? "Google" : "Apple");

const phoneOrThrow = (input: string) => {
  const phone = normalizeNigerianPhone(input);
  if (!phone)
    throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_PHONE", "Enter a valid Nigerian phone number", { fields: { phone: "Enter a valid Nigerian phone number" } });
  return phone;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly loginAttempts: LoginAttemptsService,
    private readonly notifications: NotificationsService,
    private readonly oauth: OAuthVerifierService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ---------- Sign-up ----------

  /**
   * Creates (or refreshes) an unverified account, with a 0.00 wallet, and sends a code to the phone and the email.
   * Re-registering with details of an unverified account updates it, so a user who never got the code can try again.
   */
  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
    const phone = phoneOrThrow(dto.phone);
    const [byEmail, byPhone] = await Promise.all([this.users.findByEmail(dto.email), this.users.findByPhone(phone)]);

    if (byEmail && (await this.isActivated(byEmail)))
      throw new AppException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "An account with this email already exists. Log in instead.");
    if (byPhone?.phoneVerifiedAt) throw new AppException(HttpStatus.CONFLICT, "PHONE_TAKEN", "An account with this phone number already exists. Log in instead.");

    const passwordHash = dto.password ? await this.passwords.hash(dto.password) : undefined;
    const data = { firstName: dto.firstName, lastName: dto.lastName, email: dto.email, phone, ...(passwordHash ? { passwordHash } : {}) };

    const user = await this.prisma.$transaction(async (tx) => {
      // Two different unverified accounts hold the email and the phone: drop the phone one.
      if (byPhone && byEmail && byPhone.id !== byEmail.id) await tx.user.delete({ where: { id: byPhone.id } });
      const existing = byEmail ?? byPhone;
      return existing
        ? tx.user.update({ where: { id: existing.id }, data: { ...data, wallet: { upsert: { create: {}, update: {} } } } })
        : tx.user.create({ data: { ...data, wallet: { create: {} } } });
    });

    const verification = await this.sendSignupCode(user);
    return {
      message: `We sent a ${verification.codeLength}-digit code to ${verification.destination} and ${maskEmail(user.email)}.`,
      verification,
    };
  }

  async resendSignupCode(phoneInput: string): Promise<SignupCodeDto> {
    const user = await this.users.findByPhone(phoneOrThrow(phoneInput));
    if (!user) throw new AppException(HttpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND", "We couldn't find a sign-up for that number. Start again.");
    if (user.phoneVerifiedAt) throw new AppException(HttpStatus.CONFLICT, "ALREADY_VERIFIED", "This number is already verified. Log in instead.");
    return this.sendSignupCode(user);
  }

  /** Confirms the phone with the code (sent by SMS and email) and signs the user in. */
  async verifyPhone(dto: VerifyPhoneDto, client: ClientInfo): Promise<AuthResponseDto> {
    const user = await this.users.findByPhone(phoneOrThrow(dto.phone));
    if (!user) throw new AppException(HttpStatus.BAD_REQUEST, "CODE_EXPIRED", "This code has expired. Request a new one.");
    if (user.phoneVerifiedAt) throw new AppException(HttpStatus.CONFLICT, "ALREADY_VERIFIED", "This number is already verified. Log in instead.");

    await this.otp.verify("signup", user.id, dto.code);
    const verified = await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date(), lastLoginAt: new Date() } });
    return this.session(verified, client);
  }

  // ---------- Login ----------

  /** First step of the two-step login: greets the user and shows where a reset code would go. */
  async lookup(email: string): Promise<LookupResponseDto> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== "ACTIVE")
      throw new AppException(HttpStatus.NOT_FOUND, "ACCOUNT_NOT_FOUND", "We couldn't find an account with that email.");
    return { firstName: user.firstName, avatarUrl: user.avatarUrl, maskedPhone: user.phone ? maskPhone(user.phone) : null, maskedEmail: maskEmail(user.email) };
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<AuthResponseDto> {
    await this.loginAttempts.assertNotLocked(dto.email);

    const user = await this.users.findByEmail(dto.email);
    const ok = await this.passwords.verify(user?.passwordHash, dto.password);
    if (!user || !ok) {
      const attemptsRemaining = await this.loginAttempts.recordFailure(dto.email);
      if (attemptsRemaining === 0) await this.loginAttempts.assertNotLocked(dto.email);
      throw new AppException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect.", { attemptsRemaining });
    }
    await this.loginAttempts.clear(dto.email);

    if (user.status !== "ACTIVE") throw new AppException(HttpStatus.FORBIDDEN, "ACCOUNT_SUSPENDED", "This account is suspended. Contact support.");
    if (!(await this.isActivated(user)) && user.phone) {
      const verification = await this.sendSignupCode(user).catch(() => undefined);
      throw new AppException(HttpStatus.FORBIDDEN, "PHONE_NOT_VERIFIED", "Verify your phone number to continue. We've sent you a code.", {
        phone: user.phone,
        verification,
      });
    }

    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.session(updated, client);
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthResponseDto> {
    const { userId, tokens } = await this.tokens.rotate(refreshToken, client);
    const user = await this.users.getOrThrow(userId);
    return { ...tokens, ...(await this.accountState(user)) };
  }

  logout(refreshToken: string) {
    return this.tokens.revokeByRefreshToken(refreshToken);
  }

  async logoutAll(userId: string) {
    await this.tokens.revokeAllForUser(userId, "logout_all");
  }

  // ---------- Google / Apple ----------

  async signInWithGoogle(dto: GoogleSignInDto, client: ClientInfo): Promise<OAuthResultDto> {
    return this.oauthSignIn(await this.oauth.google(dto), client);
  }

  async signInWithApple(dto: AppleSignInDto, client: ClientInfo): Promise<OAuthResultDto> {
    return this.oauthSignIn(await this.oauth.apple(dto), client);
  }

  /**
   * Always signs in — no SMS code: the provider has already proved who the user is.
   *  - identity already linked → that account
   *  - an account with the same (provider-verified) email → link it and sign in
   *  - otherwise → create the account (with a 0.00 wallet, no phone yet)
   * `requiresProfileCompletion` tells the app to ask for the missing phone number / name.
   */
  private async oauthSignIn(identity: OAuthIdentity, client: ClientInfo): Promise<OAuthResultDto> {
    const key = { provider: identity.provider, providerUserId: identity.providerUserId };
    const link = await this.prisma.oAuthAccount.findUnique({ where: { provider_providerUserId: key }, include: { user: true } });
    let user = link?.user ?? (identity.email ? await this.users.findByEmail(identity.email) : null);

    if (!user) {
      if (!identity.email)
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          "OAUTH_EMAIL_REQUIRED",
          `We need the email on your ${providerLabel(identity.provider)} account to create your Gbanjo account. Allow access to your email and try again.`,
        );
      user = await this.prisma.user.create({
        data: {
          firstName: identity.firstName ?? "",
          lastName: identity.lastName ?? "",
          email: identity.email,
          emailVerifiedAt: new Date(),
          avatarUrl: identity.avatarUrl,
          wallet: { create: {} },
          oauthAccounts: { create: { ...key, email: identity.email } },
        },
      });
      this.logger.log(`User ${user.id} created with ${providerLabel(identity.provider)}`);
    } else {
      if (user.status !== "ACTIVE") throw new AppException(HttpStatus.FORBIDDEN, "ACCOUNT_SUSPENDED", "This account is suspended. Contact support.");

      // An unfinished sign-up (never verified) that happens to use this email isn't trusted: whoever started it
      // never proved they own the email or the phone. Reset it so only the provider-verified owner can get in.
      const unclaimed = !link && !(await this.isActivated(user));
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...(unclaimed
            ? { passwordHash: null, phone: null, phoneVerifiedAt: null, firstName: identity.firstName ?? user.firstName, lastName: identity.lastName ?? user.lastName }
            : {}),
          ...(!user.emailVerifiedAt && identity.email === user.email ? { emailVerifiedAt: new Date() } : {}),
          ...(!user.avatarUrl && identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
          wallet: { upsert: { create: {}, update: {} } },
        },
      });
      await this.prisma.oAuthAccount.upsert({
        where: { provider_providerUserId: key },
        create: { userId: user.id, ...key, email: identity.email },
        update: { lastUsedAt: new Date() },
      });
    }

    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { status: "authenticated", ...(await this.session(updated, client)) };
  }

  // ---------- Passwords ----------

  /** Always answers the same way so it can't be used to find out which emails have accounts. */
  async forgotPassword(dto: ForgotPasswordDto): Promise<ForgotPasswordResponseDto> {
    const response = {
      message: "If an account exists for that email, we've sent a code.",
      codeLength: this.otp.codeLength,
      resendIn: this.otp.resendCooldown,
    };
    const user = await this.users.findByEmail(dto.email);
    if (!user || user.status !== "ACTIVE") return response;
    // Accounts without a phone yet (Google/Apple) get the code by email.
    const channel = dto.channel === "sms" && user.phone ? "sms" : "email";

    try {
      const issued = await this.otp.issue("password_reset", user.id);
      await this.notifications.sendOtp({
        channel,
        to: channel === "sms" ? user.phone! : user.email,
        code: issued.code,
        purpose: "password_reset",
        firstName: user.firstName,
        expiresInMinutes: Math.round(issued.expiresIn / 60),
      });
    } catch (e) {
      // Cooldown / hourly limit: stay silent rather than reveal the account exists.
      if (!(e instanceof AppException)) throw e;
    }
    return response;
  }

  async verifyResetCode(dto: VerifyResetCodeDto): Promise<ResetTokenResponseDto> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new AppException(HttpStatus.BAD_REQUEST, "CODE_EXPIRED", "This code has expired. Request a new one.");
    await this.otp.verify("password_reset", user.id, dto.code);

    const resetToken = randomToken();
    await this.redis.set(`pwreset:${sha256(resetToken)}`, user.id, "EX", RESET_TOKEN_TTL_SECONDS);
    return { resetToken, expiresIn: RESET_TOKEN_TTL_SECONDS };
  }

  /** Sets the new password and signs the user out everywhere. */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.redis.getdel(`pwreset:${sha256(dto.resetToken)}`);
    if (!userId) throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_RESET_TOKEN", "This reset link has expired. Start again.");

    const user = await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(dto.password) } });
    await this.tokens.revokeAllForUser(user.id, "password_reset");
    await this.loginAttempts.clear(user.email);
    await this.notifications.passwordChanged({ email: user.email, phone: user.phone, firstName: user.firstName });
  }

  /** For accounts created without a password (mobile sign-up). */
  async setPassword(userId: string, password: string): Promise<void> {
    const user = await this.users.getOrThrow(userId);
    if (user.passwordHash) throw new AppException(HttpStatus.CONFLICT, "PASSWORD_ALREADY_SET", "You already have a password. Use change password instead.");
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(password) } });
  }

  /** Changes the password and signs out every other device. */
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.getOrThrow(userId);
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword)))
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_PASSWORD", "Your current password is incorrect.", {
        fields: { currentPassword: "Your current password is incorrect." },
      });
    if (dto.currentPassword === dto.newPassword)
      throw new AppException(HttpStatus.BAD_REQUEST, "PASSWORD_UNCHANGED", "Choose a password you haven't just used.", {
        fields: { newPassword: "Choose a password you haven't just used." },
      });

    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(dto.newPassword) } });
    await this.tokens.revokeAllForUser(userId, "password_changed", sessionId);
    await this.notifications.passwordChanged({ email: user.email, phone: user.phone, firstName: user.firstName });
  }

  // ---------- helpers ----------

  /** Sends the same sign-up code by SMS and by email. */
  private async sendSignupCode(user: User & { phone: string | null }): Promise<SignupCodeDto> {
    if (!user.phone) throw new AppException(HttpStatus.BAD_REQUEST, "PHONE_REQUIRED", "Add a phone number first.");
    const issued = await this.otp.issue("signup", user.id);
    const job = { code: issued.code, purpose: "signup" as const, firstName: user.firstName, expiresInMinutes: Math.round(issued.expiresIn / 60) };
    await Promise.all([
      this.notifications.sendOtp({ ...job, channel: "sms", to: user.phone }),
      this.notifications.sendOtp({ ...job, channel: "email", to: user.email }),
    ]);
    return { channel: "sms", destination: maskPhone(user.phone), codeLength: issued.codeLength, expiresIn: issued.expiresIn, resendIn: issued.resendIn };
  }

  private async session(user: User, client: ClientInfo): Promise<AuthResponseDto> {
    const tokens = await this.tokens.createSession(user, client);
    this.logger.log(`User ${user.id} signed in`);
    return { ...tokens, ...(await this.accountState(user)) };
  }

  private async hasSocialLogin(userId: string) {
    return (await this.prisma.oAuthAccount.count({ where: { userId } })) > 0;
  }

  /** A usable account: the phone was confirmed with a code, or the user signs in with Google/Apple. */
  private async isActivated(user: User) {
    return !!user.phoneVerifiedAt || (await this.hasSocialLogin(user.id));
  }

  /** The user plus what the app still has to ask for. */
  private async accountState(user: User) {
    const social = await this.hasSocialLogin(user.id);
    return {
      user: UserResponseDto.from(user),
      // Google/Apple users don't need a password (they can add one later with forgot password).
      requiresPasswordSetup: !user.passwordHash && !social,
      requiresProfileCompletion: !UserResponseDto.isProfileComplete(user),
    };
  }
}
