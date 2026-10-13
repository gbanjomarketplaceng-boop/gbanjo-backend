import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from "class-validator";
import { PASSWORD_MESSAGE, PASSWORD_RULE } from "../auth.constants";
import { CodeField, EmailField, NewPasswordField, PhoneField } from "./fields";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class RegisterDto {
  @ApiProperty({ example: "Romina" })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: "Enter your first name" })
  firstName!: string;

  @ApiProperty({ example: "Williams" })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: "Enter your last name" })
  lastName!: string;

  @EmailField() email!: string;
  @PhoneField() phone!: string;

  @ApiPropertyOptional({ example: "Gbanjo2026", description: `Optional — the mobile app creates it after the phone is verified. ${PASSWORD_MESSAGE}` })
  @IsOptional()
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password?: string;
}

export class GoogleSignInDto {
  @ApiPropertyOptional({ description: "ID token from Google Sign-In (mobile). Send this or `code`." })
  @ValidateIf((o: GoogleSignInDto) => !o.code)
  @IsString()
  @IsNotEmpty({ message: "Missing Google sign-in token" })
  @MaxLength(4096)
  idToken?: string;

  @ApiPropertyOptional({ description: "Authorization code from the Google popup on the web (redirect_uri=postmessage). Send this or `idToken`." })
  @ValidateIf((o: GoogleSignInDto) => !o.idToken)
  @IsString()
  @IsNotEmpty({ message: "Missing Google sign-in token" })
  @MaxLength(2048)
  code?: string;
}

export class AppleSignInDto {
  @ApiProperty({ description: "identityToken from Sign in with Apple" })
  @IsString()
  @IsNotEmpty({ message: "Missing Apple sign-in token" })
  @MaxLength(4096)
  idToken!: string;

  @ApiPropertyOptional({ description: "Apple only shares the name with the app on the first sign-in, so pass it through when present." })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  lastName?: string;
}

export class VerifyPhoneDto {
  @PhoneField() phone!: string;
  @CodeField() code!: string;
}

export class ResendOtpDto {
  @PhoneField() phone!: string;
}

export class LookupDto {
  @EmailField() email!: string;
}

export class LoginDto {
  @EmailField() email!: string;

  @ApiProperty({ example: "Gbanjo2026" })
  @IsString()
  @IsNotEmpty({ message: "Enter your password" })
  @MaxLength(72)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: "The refresh token from login/verify/refresh" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @EmailField() email!: string;

  @ApiProperty({ enum: ["sms", "email"], default: "sms" })
  @IsIn(["sms", "email"], { message: "Choose SMS or email" })
  channel: "sms" | "email" = "sms";
}

export class VerifyResetCodeDto {
  @EmailField() email!: string;
  @CodeField() code!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: "From POST /auth/password/verify-code" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  resetToken!: string;

  @NewPasswordField() password!: string;
}

export class SetPasswordDto {
  @NewPasswordField() password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: "Enter your current password" })
  @MaxLength(72)
  currentPassword!: string;

  @NewPasswordField() newPassword!: string;
}
