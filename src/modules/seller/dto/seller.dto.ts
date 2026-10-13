import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { Category, Product, SellerVerification } from "../../../generated/prisma/client";
import { CONDITIONS, DELIVERY_OPTIONS, ID_TYPES, LISTING_STATUSES, type ListingStatus, MAX_PHOTOS, MAX_PRICE } from "../seller.constants";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

// ---------- Verification ----------

export class SubmitVerificationDto {
  @ApiProperty({ enum: ID_TYPES, example: "nin" })
  @IsIn(ID_TYPES, { message: "Choose an ID type" })
  idType!: string;

  @ApiPropertyOptional({ example: "gbanjo/id-documents/<userId>/abc123", description: "publicId from POST /uploads/confirm (purpose id_document). Required when uploads are set up." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  documentPublicId?: string;
}

export class VerificationDto {
  @ApiProperty({ enum: ["none", "pending", "verified", "rejected"] }) status!: "none" | "pending" | "verified" | "rejected";
  @ApiPropertyOptional({ enum: ID_TYPES }) idType?: string;
  @ApiPropertyOptional({ description: "Why it was rejected" }) note?: string;
  @ApiPropertyOptional() submittedAt?: Date;

  static from(v: SellerVerification | null): VerificationDto {
    if (!v) return { status: "none" };
    return {
      status: v.status.toLowerCase() as VerificationDto["status"],
      idType: v.idType,
      ...(v.note ? { note: v.note } : {}),
      submittedAt: v.updatedAt,
    };
  }
}

class VerificationUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) phone!: string | null;
}

class SignedLinkDto {
  @ApiProperty({ description: "Short-lived link to the private ID photo" }) url!: string;
  @ApiProperty() expiresAt!: Date;
}

export class AdminVerificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: VerificationUserDto }) user!: VerificationUserDto;
  @ApiProperty({ enum: ID_TYPES }) idType!: string;
  @ApiProperty({ enum: ["PENDING", "VERIFIED", "REJECTED"] }) status!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() submittedAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: Date }) reviewedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, type: SignedLinkDto }) document!: SignedLinkDto | null;
}

export class ReviewVerificationDto {
  @ApiProperty({ enum: ["VERIFIED", "REJECTED"] })
  @IsIn(["VERIFIED", "REJECTED"])
  status!: "VERIFIED" | "REJECTED";

  @ApiPropertyOptional({ example: "The photo is blurry. Please upload a clearer one." })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

// ---------- Listings ----------

/** Every field is optional so a draft can be saved at any step; publishing checks the listing is complete. */
export class SaveListingDto {
  @ApiPropertyOptional({ example: "iPhone 13 Pro 256GB" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({ example: "electronics", description: "Category slug (GET /catalog/categories)" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ enum: CONDITIONS })
  @IsOptional()
  @IsIn(CONDITIONS)
  condition?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: "Apple" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  brand?: string;

  @ApiPropertyOptional({ example: 450000, description: "NGN, whole naira" })
  @IsOptional()
  @IsInt({ message: "Enter the price in whole naira" })
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  negotiable?: boolean;

  @ApiPropertyOptional({ example: "Ikeja, Lagos" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  location?: string;

  @ApiPropertyOptional({ enum: DELIVERY_OPTIONS })
  @IsOptional()
  @IsIn(DELIVERY_OPTIONS)
  delivery?: string;

  @ApiPropertyOptional({ type: [String], description: "Cloudinary URLs from uploads (purpose listing_photo). First one is the cover." })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PHOTOS, { message: `Add up to ${MAX_PHOTOS} photos` })
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  photos?: string[];

  @ApiPropertyOptional({ enum: LISTING_STATUSES, description: "draft = save for later, active = publish, sold = mark as sold" })
  @IsOptional()
  @IsIn(LISTING_STATUSES)
  status?: ListingStatus;
}

export class ListingDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "iphone-13-pro-256gb-k3x9qa", description: "Product page: /products/:slug (when active)" }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ example: "electronics" }) category!: string;
  @ApiProperty({ example: "Electronics" }) categoryName!: string;
  @ApiProperty({ enum: CONDITIONS }) condition!: string;
  @ApiProperty() description!: string;
  @ApiProperty() brand!: string;
  @ApiProperty() price!: number;
  @ApiProperty() negotiable!: boolean;
  @ApiProperty() location!: string;
  @ApiProperty({ enum: DELIVERY_OPTIONS }) delivery!: string;
  @ApiProperty({ type: [String] }) photos!: string[];
  @ApiProperty({ enum: LISTING_STATUSES }) status!: ListingStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static from(p: Product & { category: Category }): ListingDto {
    return {
      id: p.id,
      slug: p.slug,
      title: p.name,
      category: p.category.slug,
      categoryName: p.category.name,
      condition: p.condition ?? "Like New",
      description: p.description ?? "",
      brand: p.brand ?? "",
      price: Number(p.price),
      negotiable: p.negotiable,
      location: p.location,
      delivery: p.delivery ?? "buyer-pays",
      photos: [p.imageUrl, ...p.gallery].filter(Boolean),
      status: p.status.toLowerCase() as ListingStatus,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
