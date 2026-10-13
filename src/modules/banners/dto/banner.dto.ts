import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsDate, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min, ValidateIf } from "class-validator";
import type { Banner } from "../../../generated/prisma/client";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
/** "" → null so a field can be cleared. */
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() || null : value);

/** Shape the web/mobile apps render. */
export class BannerDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ example: "Happening Now", nullable: true, type: String }) eyebrow!: string | null;
  @ApiProperty({ example: "Big Sale" }) title!: string;
  @ApiPropertyOptional({ example: "Up to 50%", nullable: true, type: String }) highlight!: string | null;
  @ApiPropertyOptional({ example: "More of what you love. Less than you expect.", nullable: true, type: String }) subtitle!: string | null;
  @ApiPropertyOptional({ example: "Shop the sale", nullable: true, type: String }) ctaLabel!: string | null;
  @ApiPropertyOptional({ example: "/products", nullable: true, type: String }) ctaHref!: string | null;
  @ApiProperty({ example: "https://res.cloudinary.com/…/banners/big-sale.jpg" }) image!: string;
  @ApiProperty({ example: "#f8b91b" }) backgroundColor!: string;

  static from(b: Banner): BannerDto {
    return {
      id: b.id,
      eyebrow: b.eyebrow,
      title: b.title,
      highlight: b.highlight,
      subtitle: b.subtitle,
      ctaLabel: b.ctaLabel,
      ctaHref: b.ctaHref,
      image: b.imageUrl,
      backgroundColor: b.backgroundColor,
    };
  }
}

/** Admin view: everything, including schedule and status. */
export class AdminBannerDto extends BannerDto {
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiPropertyOptional({ nullable: true, type: Date }) startsAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) endsAt!: Date | null;
  @ApiProperty({ description: "Active and inside its schedule right now" }) isLive!: boolean;
  @ApiProperty() updatedAt!: Date;

  static fromAdmin(b: Banner, now = new Date()): AdminBannerDto {
    return {
      ...BannerDto.from(b),
      sortOrder: b.sortOrder,
      isActive: b.isActive,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      isLive: b.isActive && (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt > now),
      updatedAt: b.updatedAt,
    };
  }
}

export class CreateBannerDto {
  @ApiPropertyOptional({ example: "Happening Now" })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  eyebrow?: string | null;

  @ApiProperty({ example: "Big Sale" })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: "Give the banner a title (up to 60 characters)" })
  title!: string;

  @ApiPropertyOptional({ example: "Up to 50%" })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  highlight?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(160)
  subtitle?: string | null;

  @ApiPropertyOptional({ example: "Shop the sale" })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(30)
  ctaLabel?: string | null;

  @ApiPropertyOptional({ example: "/products?category=clothing", description: "A page on the site (/…) or a full https:// link" })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/, { message: "Use a site path like /products or a full https:// link" })
  @MaxLength(300)
  ctaHref?: string | null;

  @ApiProperty({ description: "From POST /uploads/confirm with purpose=banner" })
  @Transform(trim)
  @IsString()
  @Matches(/^(https:\/\/|\/)/, { message: "Upload an image for the banner" })
  @MaxLength(500)
  imageUrl!: string;

  @ApiPropertyOptional({ example: "#f8b91b" })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: "Use a colour like #f8b91b" })
  backgroundColor?: string;

  @ApiPropertyOptional({ default: 0, description: "Lower shows first" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate({ message: "Invalid start date" })
  startsAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate({ message: "Invalid end date" })
  endsAt?: Date | null;
}

export class UpdateBannerDto extends PartialType(CreateBannerDto) {}
