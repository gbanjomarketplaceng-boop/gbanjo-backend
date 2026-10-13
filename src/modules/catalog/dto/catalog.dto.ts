import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { Category, Product } from "../../../generated/prisma/client";
import { BannerDto } from "../../banners/dto/banner.dto";
import { NEW_ITEM_DAYS } from "../catalog.constants";

export class CategoryDto {
  @ApiProperty({ example: "home-decor" }) slug!: string;
  @ApiProperty({ example: "Home Decor" }) name!: string;
  @ApiProperty({ example: "Furniture & everyday living" }) blurb!: string;
  @ApiProperty({ example: "/images/cat-home-decor.png" }) image!: string;
  @ApiProperty({ example: 12, description: "Active products in this category" }) productCount!: number;

  static from(c: Category & { _count?: { products: number } }): CategoryDto {
    return { slug: c.slug, name: c.name, blurb: c.blurb, image: c.imageUrl, productCount: c._count?.products ?? 0 };
  }
}

export class BadgeDto {
  @ApiProperty({ example: "-20%" }) label!: string;
  @ApiProperty({ enum: ["sale", "new"] }) tone!: "sale" | "new";
}

export class ProductSellerDto {
  @ApiProperty({ description: "Seller's user id (to hide “Message seller” on your own listings)" }) id!: string;
  @ApiProperty({ example: "Femi Tayo" }) name!: string;
  @ApiPropertyOptional({ example: "https://res.cloudinary.com/.../avatar.jpg" }) avatar?: string;
  @ApiProperty({ description: "Seller's ID has been checked" }) verified!: boolean;
  @ApiProperty({ example: "Ikeja, Lagos" }) address!: string;
}

/** What a product row needs loaded to become a ProductDto. */
export const PRODUCT_INCLUDE = {
  category: true,
  seller: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, sellerVerification: { select: { status: true } } } },
} as const;

type SellerRow = { id: string; firstName: string; lastName: string; avatarUrl: string | null; sellerVerification: { status: string } | null } | null;

/** Same shape the web app's ProductCard uses. `id` is the URL slug. */
export class ProductDto {
  @ApiProperty({ example: "olive-low-top-sneakers", description: "URL slug (use it in /products/:id)" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: "/images/l-olive-sneakers.png" }) image!: string;
  @ApiProperty({ type: [String] }) gallery!: string[];
  @ApiProperty({ example: 17000 }) price!: number;
  @ApiPropertyOptional({ example: 20000 }) oldPrice?: number;
  @ApiPropertyOptional({ type: BadgeDto }) badge?: BadgeDto;
  @ApiProperty({ example: "clothing", description: "Category slug" }) category!: string;
  @ApiProperty({ example: "Clothing" }) categoryName!: string;
  @ApiProperty({ example: "Clothing · Footwear" }) tags!: string;
  @ApiProperty({ example: "Lagos, Nigeria" }) location!: string;
  @ApiProperty({ example: 4.5 }) rating!: number;
  @ApiProperty({ example: 20 }) reviews!: number;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: [String] }) variations!: string[];
  @ApiPropertyOptional({ example: "Size S · Like new" }) condition?: string;
  @ApiPropertyOptional({ description: "When the flash-sale price ends" }) flashSaleEndsAt?: Date;
  @ApiPropertyOptional({ example: "Samsung" }) brand?: string;
  @ApiPropertyOptional({ description: "Seller accepts offers" }) negotiable?: boolean;
  @ApiPropertyOptional({ enum: ["buyer-pays", "i-deliver", "pickup"] }) delivery?: string;
  @ApiPropertyOptional({ type: ProductSellerDto, description: "Set for items listed by a Gbanjo seller" }) seller?: ProductSellerDto;
  @ApiProperty() createdAt!: Date;

  static from(p: Product & { category: Category; seller?: SellerRow }, now = new Date()): ProductDto {
    const price = Number(p.price);
    const oldPrice = p.oldPrice !== null ? Number(p.oldPrice) : undefined;
    const onSale = oldPrice !== undefined && oldPrice > price;
    const isNew = now.getTime() - p.createdAt.getTime() < NEW_ITEM_DAYS * 86_400_000;
    const badge: BadgeDto | undefined = onSale
      ? { label: `-${Math.round((1 - price / oldPrice!) * 100)}%`, tone: "sale" }
      : isNew
        ? { label: "New", tone: "new" }
        : undefined;
    return {
      id: p.slug,
      name: p.name,
      image: p.imageUrl,
      gallery: p.gallery,
      price,
      ...(onSale ? { oldPrice } : {}),
      ...(badge ? { badge } : {}),
      category: p.category.slug,
      categoryName: p.category.name,
      tags: p.tags,
      location: p.location,
      rating: Number(p.rating),
      reviews: p.reviewCount,
      ...(p.description ? { description: p.description } : {}),
      variations: p.variations,
      ...(p.condition ? { condition: p.condition } : {}),
      ...(p.flashSaleEndsAt && p.flashSaleEndsAt > now ? { flashSaleEndsAt: p.flashSaleEndsAt } : {}),
      ...(p.brand ? { brand: p.brand } : {}),
      ...(p.sellerId ? { negotiable: p.negotiable } : {}),
      ...(p.delivery ? { delivery: p.delivery } : {}),
      ...(p.seller
        ? {
            seller: {
              id: p.seller.id,
              name: `${p.seller.firstName} ${p.seller.lastName}`.trim(),
              ...(p.seller.avatarUrl ? { avatar: p.seller.avatarUrl } : {}),
              verified: p.seller.sellerVerification?.status === "VERIFIED",
              address: p.location,
            },
          }
        : {}),
      createdAt: p.createdAt,
    };
  }
}

export class ProductPageDto {
  @ApiProperty({ type: [ProductDto] }) items!: ProductDto[];
  @ApiProperty({ example: 42 }) total!: number;
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 24 }) limit!: number;
}

export class FlashSaleDto {
  @ApiPropertyOptional({ description: "Earliest end time among the items (for a countdown)", nullable: true, type: Date }) endsAt!: Date | null;
  @ApiProperty({ type: [ProductDto] }) items!: ProductDto[];
}

export class HomeDto {
  @ApiProperty({ type: [BannerDto] }) banners!: BannerDto[];
  @ApiProperty({ type: [CategoryDto] }) categories!: CategoryDto[];
  @ApiProperty({ type: FlashSaleDto }) flashSale!: FlashSaleDto;
  @ApiProperty({ type: [ProductDto] }) newItems!: ProductDto[];
  @ApiProperty({ type: [ProductDto] }) justForYou!: ProductDto[];
}

export class SuggestionsDto {
  @ApiProperty({ example: "sneak" }) query!: string;
  @ApiProperty({ type: [ProductDto] }) products!: ProductDto[];
  @ApiProperty({ type: [CategoryDto] }) categories!: CategoryDto[];
  @ApiProperty({ example: 6, description: "All products matching the query" }) total!: number;
}
