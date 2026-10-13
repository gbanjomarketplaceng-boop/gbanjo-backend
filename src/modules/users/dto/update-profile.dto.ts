import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, IsUrl, Length, MaxLength, ValidateIf } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** Phone changes need a verified SMS code, so they're not editable here. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: "Romina" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: "First name must be 1–60 characters" })
  firstName?: string;

  @ApiPropertyOptional({ example: "Williams" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: "Last name must be 1–60 characters" })
  lastName?: string;

  @ApiPropertyOptional({ example: "romina.williams@email.com", description: "Changing it marks the email unverified" })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: "Enter a valid email address" })
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: "https://cdn.gbanjo.com/avatars/romina.jpg", nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ require_protocol: true }, { message: "Avatar must be a URL" })
  avatarUrl?: string | null;
}
