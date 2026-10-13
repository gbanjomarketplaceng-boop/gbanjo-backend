import { applyDecorators } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import { PASSWORD_MESSAGE, PASSWORD_RULE } from "../auth.constants";

/** Shared field decorators so every auth DTO validates the same way. */
export const EmailField = () =>
  applyDecorators(
    ApiProperty({ example: "romina.williams@email.com" }),
    Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)),
    IsEmail({}, { message: "Enter a valid email address" }),
    MaxLength(254),
  );

export const PhoneField = () =>
  applyDecorators(
    ApiProperty({ example: "09045654356", description: "Nigerian mobile number, any common format (0…, 234…, +234…)" }),
    IsString(),
    IsNotEmpty({ message: "Enter your phone number" }),
    MaxLength(20),
  );

export const NewPasswordField = () =>
  applyDecorators(
    ApiProperty({ example: "Gbanjo2026", description: PASSWORD_MESSAGE }),
    IsString(),
    Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE }),
  );

export const CodeField = () =>
  applyDecorators(ApiProperty({ example: "1234", description: "The code from the SMS/email" }), IsString(), Matches(/^\d{4,8}$/, { message: "Enter the code we sent you" }));
