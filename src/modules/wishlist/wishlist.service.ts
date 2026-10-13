import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { PRODUCT_INCLUDE, ProductDto } from "../catalog/dto/catalog.dto";

/** Most items one wishlist can hold. */
export const WISHLIST_MAX = 500;

/** Saved items for signed-in users. Only items still for sale are returned. */
@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ProductDto[]> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId, product: { status: "ACTIVE" } },
      include: { product: { include: PRODUCT_INCLUDE } },
      orderBy: { createdAt: "asc" },
    });
    const now = new Date();
    return rows.map((r) => ProductDto.from(r.product, now));
  }

  async add(userId: string, slug: string): Promise<ProductDto[]> {
    const product = await this.prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, select: { id: true } });
    if (!product) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "This item isn't available any more.");
    const count = await this.prisma.wishlistItem.count({ where: { userId } });
    if (count >= WISHLIST_MAX) throw new AppException(HttpStatus.CONFLICT, "WISHLIST_FULL", `Your wishlist is full (${WISHLIST_MAX} items). Remove some to save more.`);
    await this.prisma.wishlistItem.upsert({
      where: { userId_productId: { userId, productId: product.id } },
      create: { userId, productId: product.id },
      update: {},
    });
    return this.list(userId);
  }

  async remove(userId: string, slug: string): Promise<void> {
    await this.prisma.wishlistItem.deleteMany({ where: { userId, product: { slug } } });
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.wishlistItem.deleteMany({ where: { userId } });
  }

  /** Adds items saved while signed out (unknown or unavailable ones are skipped). */
  async merge(userId: string, slugs: string[]): Promise<ProductDto[]> {
    const unique = [...new Set(slugs)];
    if (unique.length) {
      const [products, count] = await Promise.all([
        this.prisma.product.findMany({ where: { slug: { in: unique }, status: "ACTIVE" }, select: { id: true } }),
        this.prisma.wishlistItem.count({ where: { userId } }),
      ]);
      await this.prisma.wishlistItem.createMany({
        data: products.slice(0, Math.max(0, WISHLIST_MAX - count)).map((p) => ({ userId, productId: p.id })),
        skipDuplicates: true,
      });
    }
    return this.list(userId);
  }
}
