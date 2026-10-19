import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { UserResponseDto } from "../../users/dto/user-response.dto";

export class SignupCodeDto {
  @ApiProperty({ enum: ["sms", "email"] }) channel!: "sms" | "email";
  @ApiProperty({ example: "+234*******56", description: "Masked phone/email the code went to" }) destination!: string;
  @ApiProperty({ example: 4 }) codeLength!: number;
  @ApiProperty({ example: 600, description: "Seconds until the code expires" }) expiresIn!: number;
  @ApiProperty({ example: 60, description: "Seconds until another code can be requested" }) resendIn!: number;
}

export class RegisterResponseDto {
  @ApiProperty({ example: "We sent a 4-digit code to +234*******56." }) message!: string;
  @ApiProperty({ type: SignupCodeDto }) verification!: SignupCodeDto;
}

export class AuthTokensDto {
  @ApiProperty({ example: "Bearer" }) tokenType!: "Bearer";
  @ApiProperty() accessToken!: string;
  @ApiProperty({ example: 900, description: "Access token lifetime in seconds" }) accessTokenExpiresIn!: number;
  @ApiProperty({ description: "Opaque, single-use. Send to /auth/refresh for a new pair." }) refreshToken!: string;
  @ApiProperty() refreshTokenExpiresAt!: string;
}

export class AuthResponseDto extends AuthTokensDto {
  @ApiProperty({ type: UserResponseDto }) user!: UserResponseDto;
  @ApiProperty({ description: "True when the user still has to create a password (POST /auth/password/set)" })
  requiresPasswordSetup!: boolean;
  @ApiProperty({ description: "True when the profile is missing details (e.g. a Google/Apple account with no phone yet): send the user to POST /users/me/complete-profile" })
  requiresProfileCompletion!: boolean;
}

export class LookupResponseDto {
  @ApiProperty({ example: "Romina" }) firstName!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) avatarUrl!: string | null;
  @ApiPropertyOptional({ example: "+234*******56", nullable: true, type: String, description: "Null when the account has no phone yet" }) maskedPhone!: string | null;
  @ApiProperty({ example: "ro***@email.com" }) maskedEmail!: string;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({ example: "If an account exists for that email, we've sent a code." }) message!: string;
  @ApiProperty({ example: 4 }) codeLength!: number;
  @ApiProperty({ example: 60 }) resendIn!: number;
}

export class ResetTokenResponseDto {
  @ApiProperty() resetToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
}

/** Google/Apple always sign in (no SMS code). `requiresProfileCompletion` says whether to ask for the phone number. */
export class OAuthResultDto extends AuthResponseDto {
  @ApiProperty({ enum: ["authenticated"] }) status!: "authenticated";
}
