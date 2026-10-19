import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
  ValidateIf,
} from "class-validator";

const PHOTO_URL = /^(https:\/\/[^\s]+|\/images\/[\w./-]+)$/;
const LISTING_CONDITIONS = ["New", "Like New", "Used", "Fairly Used"];
const LISTING_DELIVERY = ["buyer-pays", "i-deliver", "pickup"];

const ROLES = ["SUPER", "FINANCE", "SUPPORT", "CATALOG"] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class PageQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
  @ApiPropertyOptional({ description: "Search text" }) @IsOptional() @IsString() @MaxLength(100) @Transform(trim) q?: string;
}

export class DashboardQuery {
  @ApiPropertyOptional({ enum: [7, 30, 90, 365], default: 30 }) @IsOptional() @Type(() => Number) @IsIn([7, 30, 90, 365]) days?: number;
}

export class DateRangeQuery {
  @ApiPropertyOptional({ example: "2026-10-01", description: "From this day (inclusive). Default: 30 days ago." }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ example: "2026-10-31", description: "Up to this day (inclusive). Default: today." }) @IsOptional() @IsISO8601() to?: string;
}

export class AdminPaymentsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ["pending", "successful", "failed", "canceled"] }) @IsOptional() @IsIn(["pending", "successful", "failed", "canceled"]) status?: string;
  @ApiPropertyOptional({ enum: ["order", "top_up"] }) @IsOptional() @IsIn(["order", "top_up"]) purpose?: string;
}

export class AdminLedgerQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ["top_up", "order_payment", "refund", "sale", "withdrawal", "adjustment"] })
  @IsOptional()
  @IsIn(["top_up", "order_payment", "refund", "sale", "withdrawal", "adjustment"])
  type?: string;
}

export class ExportQuery extends DateRangeQuery {}

export class WalletAdjustmentDto {
  @ApiProperty({ example: 5000, description: "Naira: positive adds money, negative takes it away" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  @Min(-10_000_000)
  @Max(10_000_000)
  amount!: number;

  @ApiProperty({ example: "Goodwill credit for a late delivery (ticket #1042)" })
  @IsString()
  @Transform(trim)
  @MinLength(5)
  @MaxLength(200)
  reason!: string;
}

export class AdminListingsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ["active", "draft", "sold", "hidden", "featured"] }) @IsOptional() @IsIn(["active", "draft", "sold", "hidden", "featured"]) status?: string;
  @ApiPropertyOptional({ example: "clothing" }) @IsOptional() @IsString() @MaxLength(60) category?: string;
}

export class UpdateListingDto {
  @ApiPropertyOptional({ description: "Show it first in “Just for you”" }) @IsOptional() @IsBoolean() featured?: boolean;

  @ApiPropertyOptional({ description: "Put it in the flash sale until this time (null ends the sale)", example: "2026-10-31T23:59:00Z", nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  flashSaleEndsAt?: string | null;

  @ApiPropertyOptional({ description: "Crossed-out price shown during the flash sale (must be above the price)", example: 24000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000_000)
  oldPrice?: number;

  // ---- Full edit (all optional: only what's sent changes) ----
  @ApiPropertyOptional({ example: "Olive low-top sneakers" }) @IsOptional() @IsString() @Transform(trim) @MinLength(3) @MaxLength(80) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Transform(trim) @MaxLength(2000) description?: string | null;
  @ApiPropertyOptional({ example: 9000, description: "₦, whole naira" }) @IsOptional() @IsInt({ message: "Enter the price in whole naira" }) @Min(1) @Max(1_000_000_000) price?: number;
  @ApiPropertyOptional({ example: "clothing", description: "Category slug" }) @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional({ enum: LISTING_CONDITIONS }) @IsOptional() @IsIn(LISTING_CONDITIONS) condition?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Transform(trim) @MaxLength(60) brand?: string | null;
  @ApiPropertyOptional({ example: "Ikeja, Lagos" }) @IsOptional() @IsString() @Transform(trim) @MinLength(2) @MaxLength(120) location?: string;
  @ApiPropertyOptional({ type: [String], description: "First photo is the cover. https links or /images/... paths" })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: "Add at least one photo" })
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Matches(PHOTO_URL, { each: true, message: "Each photo must be an https link or a /images/... path" })
  photos?: string[];
  @ApiPropertyOptional({ enum: ["active", "draft", "sold"] }) @IsOptional() @IsIn(["active", "draft", "sold"]) status?: "active" | "draft" | "sold";
  @ApiPropertyOptional() @IsOptional() @IsBoolean() negotiable?: boolean;
  @ApiPropertyOptional({ enum: LISTING_DELIVERY }) @IsOptional() @IsIn(LISTING_DELIVERY) delivery?: string;
  @ApiPropertyOptional({ description: "Seller's email. Empty or null = sold by Gbanjo itself", nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== "")
  @IsEmail()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  sellerEmail?: string | null;
}

/** New listing: same fields as editing; name, price, category, location and photos are required (checked by the service). */
export class CreateListingDto extends UpdateListingDto {}

const toPhone = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  const v = value.replace(/[\s-]/g, "");
  if (!v) return null;
  return v.startsWith("0") ? `+234${v.slice(1)}` : v;
};

export class CreateUserDto {
  @ApiProperty({ example: "Tolu" }) @IsString() @Transform(trim) @MinLength(1) @MaxLength(50) firstName!: string;
  @ApiProperty({ example: "Bello" }) @IsString() @Transform(trim) @MinLength(1) @MaxLength(50) lastName!: string;
  @ApiProperty({ example: "tolu@example.com" }) @IsEmail() @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)) email!: string;
  @ApiPropertyOptional({ example: "+2348012345678", nullable: true })
  @IsOptional()
  @Transform(toPhone)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\+\d{8,15}$/, { message: "Use a phone number like +2348012345678" })
  phone?: string | null;
  @ApiProperty({ example: "Gbanjo2026", description: "8–72 characters with a letter and a number" })
  @IsString()
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/, { message: "Password must be 8–72 characters and include a letter and a number" })
  password!: string;
  @ApiPropertyOptional({ enum: ROLES, nullable: true, description: "Make them an admin with this role (only super admins). Empty = normal customer" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(ROLES)
  adminRole?: (typeof ROLES)[number] | null;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @MinLength(1) @MaxLength(50) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @MinLength(1) @MaxLength(50) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)) email?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toPhone)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\+\d{8,15}$/, { message: "Use a phone number like +2348012345678" })
  phone?: string | null;
  @ApiPropertyOptional({ description: "Set a new password (signs them out everywhere)" })
  @IsOptional()
  @IsString()
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,72}$/, { message: "Password must be 8–72 characters and include a letter and a number" })
  password?: string;
}

export class SaveCategoryDto {
  @ApiProperty({ example: "Kids & Baby" }) @IsString() @Transform(trim) @MinLength(2) @MaxLength(40) name!: string;
  @ApiPropertyOptional({ example: "kids-baby" }) @IsOptional() @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "Use lowercase letters, numbers and dashes" }) @MaxLength(40) slug?: string;
  @ApiPropertyOptional({ example: "Clothes, toys & essentials" }) @IsOptional() @IsString() @Transform(trim) @MaxLength(80) blurb?: string;
  @ApiPropertyOptional({ example: "https://res.cloudinary.com/x/image/upload/v1/gbanjo/banners/kids.jpg" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ValidateIf((_, v: string) => !v.startsWith("/images/"))
  @IsUrl({ protocols: ["https"], require_protocol: true })
  imageUrl?: string;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

export class SaveVoucherDto {
  @ApiProperty({ example: "LAUNCH20" }) @IsString() @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z0-9]{3,20}$/, { message: "3–20 letters or numbers" }) code!: string;
  @ApiProperty({ example: 20 }) @IsInt() @Min(1) @Max(90) percentOff!: number;
  @ApiPropertyOptional({ example: "Launch week promo" }) @IsOptional() @IsString() @Transform(trim) @MaxLength(120) description?: string;
  @ApiPropertyOptional({ example: 100, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @ApiPropertyOptional({ example: 10000, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) minOrder?: number | null;
  @ApiPropertyOptional({ example: "2026-12-31T23:59:00Z", nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() expiresAt?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateVoucherDto {
  @ApiPropertyOptional({ example: 15 }) @IsOptional() @IsInt() @Min(1) @Max(90) percentOff?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Transform(trim) @MaxLength(120) description?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1_000_000) maxUses?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) minOrder?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsISO8601() expiresAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}


export class AddAdminDto {
  @ApiProperty({ example: "tolu@gbanjo.com" }) @IsEmail() @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)) email!: string;
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) adminRole!: (typeof ROLES)[number];
}

export class UpdateAdminDto {
  @ApiProperty({ enum: ROLES, nullable: true, description: "null removes their admin access" })
  @ValidateIf((_, v) => v !== null)
  @IsIn(ROLES)
  adminRole!: (typeof ROLES)[number] | null;
}

export class BroadcastDto {
  @ApiProperty({ example: "Weekend sale is live" }) @IsString() @Transform(trim) @MinLength(3) @MaxLength(80) title!: string;
  @ApiProperty({ example: "Up to 50% off sneakers until Sunday." }) @IsString() @Transform(trim) @MinLength(3) @MaxLength(300) body!: string;
  @ApiPropertyOptional({ example: "/products?q=sneakers", description: "A page on the site/app (starts with /)" })
  @IsOptional()
  @IsString()
  @Matches(/^\/[A-Za-z0-9\-._~/?=&%]*$/, { message: "Use a path on the site, e.g. /products?q=sneakers" })
  @MaxLength(200)
  href?: string;
  @ApiProperty({ enum: ["everyone", "buyers", "sellers"] }) @IsIn(["everyone", "buyers", "sellers"]) audience!: "everyone" | "buyers" | "sellers";
  @ApiProperty({ enum: ["announcement", "promo"], description: "Promotions only reach people who allow offers" }) @IsIn(["announcement", "promo"]) kind!: "announcement" | "promo";
}

export class RejectWithdrawalDto {
  @ApiProperty({ example: "Account name doesn't match the profile" }) @IsString() @Transform(trim) @MinLength(3) @MaxLength(200) reason!: string;
}
