import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { PRODUCT_INCLUDE, ProductDto } from "../catalog/dto/catalog.dto";
import { type AddCartItemDto, type CartDto, MAX_QTY, type UpdateCartItemDto } from "./dto/cart.dto";

/** Most different items one cart can hold. */
export const CART_MAX_LINES = 100;

/** Default option label when the buyer didn't pick one: first two variations, else empty. */
const defaultOption = (variations: string[]) => (variations.length ? `${variations[0]}, Size ${variations[1] ?? "M"}` : "");

/** Server-side cart for signed-in users. Items that stop being for sale drop out automatically. */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<CartDto> {
    // Sold / unpublished items can't be bought: remove them.
    await this.prisma.cartItem.deleteMany({ where: { userId, product: { status: { not: "ACTIVE" } } } });
    const rows = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { product: { include: PRODUCT_INCLUDE } },
      orderBy: { createdAt: "asc" },
    });
    const now = new Date();
    const items = rows.map((r) => ({ product: ProductDto.from(r.product, now), qty: r.quantity, option: r.option }));
    return {
      items,
      count: items.reduce((n, i) => n + i.qty, 0),
      subtotal: items.reduce((n, i) => n + i.product.price * i.qty, 0),
    };
  }

  private async buyable(userId: string, slug: string) {
    const product = await this.prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, select: { id: true, sellerId: true, variations: true } });
    if (!product) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "This item isn't available any more.");
    if (product.sellerId === userId) throw new AppException(HttpStatus.BAD_REQUEST, "OWN_LISTING", "You can't buy your own listing.");
    return product;
  }

  async add(userId: string, dto: AddCartItemDto): Promise<CartDto> {
    const product = await this.buyable(userId, dto.productId);
    const key = { userId_productId: { userId, productId: product.id } };
    const existing = await this.prisma.cartItem.findUnique({ where: key });
    if (!existing && (await this.prisma.cartItem.count({ where: { userId } })) >= CART_MAX_LINES)
      throw new AppException(HttpStatus.CONFLICT, "CART_FULL", `Your cart is full (${CART_MAX_LINES} items).`);
    const qty = Math.min(MAX_QTY, (existing?.quantity ?? 0) + (dto.qty ?? 1));
    await this.prisma.cartItem.upsert({
      where: key,
      create: { userId, productId: product.id, quantity: qty, option: dto.option ?? defaultOption(product.variations) },
      update: { quantity: qty, ...(dto.option !== undefined ? { option: dto.option } : {}) },
    });
    return this.get(userId);
  }

  async update(userId: string, slug: string, dto: UpdateCartItemDto): Promise<CartDto> {
    const res = await this.prisma.cartItem.updateMany({
      where: { userId, product: { slug } },
      data: { ...(dto.qty !== undefined ? { quantity: dto.qty } : {}), ...(dto.option !== undefined ? { option: dto.option } : {}) },
    });
    if (!res.count) throw new AppException(HttpStatus.NOT_FOUND, "NOT_IN_CART", "That item isn't in your cart.");
    return this.get(userId);
  }

  async remove(userId: string, slug: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId, product: { slug } } });
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
  }

  /**
   * After sign-in: brings in the cart from this device. For an item already in the account cart the
   * larger quantity wins (so signing in twice on the same device doesn't double it). Unavailable items are skipped.
   */
  async merge(userId: string, items: AddCartItemDto[]): Promise<CartDto> {
    const bySlug = new Map<string, AddCartItemDto>();
    for (const i of items) bySlug.set(i.productId, { ...i, qty: Math.max(bySlug.get(i.productId)?.qty ?? 0, i.qty ?? 1) });
    if (bySlug.size) {
      const products = await this.prisma.product.findMany({
        where: { slug: { in: [...bySlug.keys()] }, status: "ACTIVE", OR: [{ sellerId: null }, { sellerId: { not: userId } }] },
        select: { id: true, slug: true, variations: true },
      });
      const existing = new Map((await this.prisma.cartItem.findMany({ where: { userId } })).map((c) => [c.productId, c]));
      let room = CART_MAX_LINES - existing.size;
      await this.prisma.$transaction(
        products.flatMap((p) => {
          const incoming = bySlug.get(p.slug)!;
          const have = existing.get(p.id);
          if (!have && room-- <= 0) return [];
          const qty = Math.min(MAX_QTY, Math.max(have?.quantity ?? 0, incoming.qty ?? 1));
          return [
            this.prisma.cartItem.upsert({
              where: { userId_productId: { userId, productId: p.id } },
              create: { userId, productId: p.id, quantity: qty, option: incoming.option ?? defaultOption(p.variations) },
              update: { quantity: qty },
            }),
          ];
        }),
      );
    }
    return this.get(userId);
  }
}
