import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Client, type ClientInfo } from "../../common/decorators/client-info.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { AuthService } from "./auth.service";
import {
  AppleSignInDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleSignInDto,
  LoginDto,
  LookupDto,
  RefreshTokenDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  SetPasswordDto,
  VerifyPhoneDto,
  VerifyResetCodeDto,
} from "./dto/requests.dto";
import {
  AuthResponseDto,
  ForgotPasswordResponseDto,
  LookupResponseDto,
  OAuthResultDto,
  RegisterResponseDto,
  ResetTokenResponseDto,
  VerificationDto,
} from "./dto/responses.dto";
import type { AuthUser } from "./types/auth-user";

/** Stricter per-IP limit for endpoints that send codes or check credentials. */
const Sensitive = () => Throttle({ default: { limit: 10, ttl: 60_000 } });

@ApiTags("Auth")
@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Sensitive()
  @Post("register")
  @ApiOperation({ summary: "Create an account and text a verification code to the phone" })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiConflictResponse({ description: "EMAIL_TAKEN or PHONE_TAKEN" })
  @ApiBadRequestResponse({ description: "EMAIL_MISMATCH or OAUTH_SIGNUP_EXPIRED (with oauthToken)" })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Sensitive()
  @Post("verify-phone")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Confirm the sign-up code; signs the user in" })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiTooManyRequestsResponse({ description: "TOO_MANY_ATTEMPTS" })
  verifyPhone(@Body() dto: VerifyPhoneDto, @Client() client: ClientInfo) {
    return this.auth.verifyPhone(dto, client);
  }

  @Public()
  @Sensitive()
  @Post("resend-otp")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send a new sign-up code" })
  @ApiOkResponse({ type: VerificationDto })
  @ApiTooManyRequestsResponse({ description: "OTP_COOLDOWN or OTP_LIMIT_REACHED" })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.auth.resendSignupCode(dto.phone);
  }

  @Public()
  @Sensitive()
  @Post("lookup")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Step 1 of login: find the account by email (greeting + masked contact details)" })
  @ApiOkResponse({ type: LookupResponseDto })
  @ApiNotFoundResponse({ description: "ACCOUNT_NOT_FOUND" })
  lookup(@Body() dto: LookupDto) {
    return this.auth.lookup(dto.email);
  }

  @Public()
  @Sensitive()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Log in with email and password" })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: "INVALID_CREDENTIALS (details.attemptsRemaining)" })
  @ApiForbiddenResponse({ description: "PHONE_NOT_VERIFIED (a new code is sent) or ACCOUNT_SUSPENDED" })
  @ApiTooManyRequestsResponse({ description: "ACCOUNT_LOCKED (details.retryAfter seconds)" })
  login(@Body() dto: LoginDto, @Client() client: ClientInfo) {
    return this.auth.login(dto, client);
  }

  @Public()
  @Sensitive()
  @Post("oauth/google")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in / sign up with Google (ID token from mobile, or authorization code from the web popup)" })
  @ApiOkResponse({ type: OAuthResultDto, description: "status=authenticated (signed in) or signup_required (finish with POST /auth/register + oauthToken)" })
  @ApiUnauthorizedResponse({ description: "INVALID_OAUTH_TOKEN" })
  @ApiForbiddenResponse({ description: "PHONE_NOT_VERIFIED (a new code is sent) or ACCOUNT_SUSPENDED" })
  @ApiServiceUnavailableResponse({ description: "OAUTH_NOT_CONFIGURED" })
  google(@Body() dto: GoogleSignInDto, @Client() client: ClientInfo) {
    return this.auth.signInWithGoogle(dto, client);
  }

  @Public()
  @Sensitive()
  @Post("oauth/apple")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in / sign up with Apple (identity token)" })
  @ApiOkResponse({ type: OAuthResultDto, description: "status=authenticated (signed in) or signup_required (finish with POST /auth/register + oauthToken)" })
  @ApiUnauthorizedResponse({ description: "INVALID_OAUTH_TOKEN" })
  @ApiForbiddenResponse({ description: "PHONE_NOT_VERIFIED (a new code is sent) or ACCOUNT_SUSPENDED" })
  apple(@Body() dto: AppleSignInDto, @Client() client: ClientInfo) {
    return this.auth.signInWithApple(dto, client);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Swap a refresh token for a new access + refresh token (rotation)" })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: "INVALID_REFRESH_TOKEN, or TOKEN_ROTATED for a token that was refreshed seconds ago" })
  refresh(@Body() dto: RefreshTokenDto, @Client() client: ClientInfo) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "End this device's session" })
  @ApiNoContentResponse()
  async logout(@Body() dto: RefreshTokenDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post("logout-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Sign out on every device" })
  @ApiNoContentResponse()
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.logoutAll(user.id);
  }

  @Public()
  @Sensitive()
  @Post("password/forgot")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Send a password reset code by SMS or email (same answer whether or not the account exists)" })
  @ApiAcceptedResponse({ type: ForgotPasswordResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Sensitive()
  @Post("password/verify-code")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Exchange the reset code for a short-lived reset token" })
  @ApiOkResponse({ type: ResetTokenResponseDto })
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.auth.verifyResetCode(dto);
  }

  @Public()
  @Sensitive()
  @Post("password/reset")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Set a new password with the reset token; signs out all devices" })
  @ApiNoContentResponse()
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
  }

  @ApiBearerAuth()
  @Post("password/set")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Create a password for an account that doesn't have one yet (after mobile sign-up)" })
  @ApiNoContentResponse()
  @ApiConflictResponse({ description: "PASSWORD_ALREADY_SET" })
  async setPassword(@CurrentUser() user: AuthUser, @Body() dto: SetPasswordDto) {
    await this.auth.setPassword(user.id, dto.password);
  }

  @ApiBearerAuth()
  @Sensitive()
  @Post("password/change")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Change password (needs the current one); signs out other devices" })
  @ApiNoContentResponse()
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, user.sessionId, dto);
  }
}
